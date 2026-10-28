import { stub } from '../common/testing/stub';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { DomainEventService } from '../events/domain-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { PushDispatcherService } from '../push/push-dispatcher.service';
import { GroupChatsController } from './group-chats/group-chats.controller';
import { GroupChatsService } from './group-chats/group-chats.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

/**
 * A member removed from a group gets a push on their devices, so they learn
 * of it with the app closed. Someone who leaves does not (they know), and a
 * repeated removal request pushes nothing new.
 */
const LEFT_AT = '2026-10-28T10:00:00.000Z';
const removed = {
  changed: true,
  internalId: 'conv-1',
  publicId: 'pub-1',
  leftAt: LEFT_AT,
};

function membershipService() {
  return {
    removeGroupMember: jest.fn(() => Promise.resolve(removed)),
    leaveGroup: jest.fn(() => Promise.resolve(removed)),
    getConversationParticipantIds: jest.fn(() => Promise.resolve(['owner'])),
    createSystemMessage: jest.fn(() => Promise.resolve({ id: 'sys-1' })),
    getUserHandle: jest.fn((id: string) => Promise.resolve(`@${id}`)),
  };
}

const req = stub<AuthenticatedRequest>({ user: { id: 'owner' } });

type Push = { enqueueForGroupRemoval: jest.Mock } | undefined;

describe.each([
  [
    'GroupChatsController',
    (service: ReturnType<typeof membershipService>, push: Push) =>
      new GroupChatsController(
        stub<GroupChatsService>(service),
        stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
        stub<NotificationsService>({}),
        stub<NotificationFactory>({}),
        push && stub<PushDispatcherService>(push),
      ),
  ],
  [
    'MessagesController',
    (service: ReturnType<typeof membershipService>, push: Push) =>
      new MessagesController(
        stub<MessagesService>(service),
        stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
        stub<NotificationsService>({}),
        stub<NotificationFactory>({}),
        push && stub<PushDispatcherService>(push),
      ),
  ],
])('%s: push to a removed member', (_name, make) => {
  let service: ReturnType<typeof membershipService>;
  let enqueueForGroupRemoval: jest.Mock;

  beforeEach(() => {
    service = membershipService();
    enqueueForGroupRemoval = jest.fn();
  });

  it('pushes to the member who was removed, keyed by that removal', async () => {
    const controller = make(service, { enqueueForGroupRemoval });
    await controller.removeMember(req, 'pub-1', 'removed-user');
    expect(enqueueForGroupRemoval).toHaveBeenCalledTimes(1);
    expect(enqueueForGroupRemoval).toHaveBeenCalledWith({
      recipientId: 'removed-user',
      conversationId: 'conv-1',
      removedAt: LEFT_AT,
    });
  });

  it('pushes nothing for a repeated removal', async () => {
    service.removeGroupMember.mockResolvedValueOnce({
      ...removed,
      changed: false,
    });
    const controller = make(service, { enqueueForGroupRemoval });
    await controller.removeMember(req, 'pub-1', 'removed-user');
    expect(enqueueForGroupRemoval).not.toHaveBeenCalled();
  });

  it('pushes nothing to someone who left on their own', async () => {
    const controller = make(service, { enqueueForGroupRemoval });
    await controller.leaveGroup(req, 'pub-1');
    expect(enqueueForGroupRemoval).not.toHaveBeenCalled();
  });

  it('removal still works where push is not wired in', async () => {
    const controller = make(service, undefined);
    await expect(
      controller.removeMember(req, 'pub-1', 'removed-user'),
    ).resolves.toMatchObject({ changed: true });
  });
});
