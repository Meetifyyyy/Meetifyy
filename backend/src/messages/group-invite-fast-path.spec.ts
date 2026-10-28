import { MessagingCoreService } from './core/messaging-core.service';
import { DmController } from './dm/dm.controller';
import { GroupChatsController } from './group-chats/group-chats.controller';
import { SendGroupInviteDto } from './core/dto/send-group-invite.dto';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { BlocksService } from '../users/blocks.service';
import type { VerificationAccessService } from '../common/verification/verification-access.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';
import type { DmService } from './dm/dm.service';
import type { GroupChatsService } from './group-chats/group-chats.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

/**
 * Inviting someone to a group, and accepting, in as few round trips as the
 * rules allow.
 *
 * Inviting used to take two requests from the client (find or create the DM,
 * then send a card the client had assembled itself), and for someone the
 * inviter had never messaged it sent to a "draft" id the server cannot
 * resolve, so it failed. Accepting waited for the "joined the group" line and
 * two participant reads before answering.
 */
const ME = 'u-me';
const THEM = 'u-them';
const GROUP = 'g-int';
const req = stub<AuthenticatedRequest>({ user: { id: ME } });

describe('MessagingCoreService.buildGroupInvite', () => {
  type Row = { userId: string; leftAt: Date | null; deletedAt: Date | null };
  let rows: Row[];
  let conv: { status: string } | null;
  let service: MessagingCoreService;

  beforeEach(() => {
    rows = [{ userId: ME, leftAt: null, deletedAt: null }];
    conv = { status: 'ACTIVE' };
    const prisma = {
      conversation: {
        findFirst: jest.fn(() =>
          Promise.resolve(
            conv && {
              id: GROUP,
              publicId: 'pub-g',
              name: 'Design Crew',
              avatarKey: 'groups/a.webp',
              description: 'We draw',
              whoCanJoin: 'Request required',
              status: conv.status,
            },
          ),
        ),
      },
      conversationParticipant: {
        findMany: jest.fn(() => Promise.resolve(rows)),
        count: jest.fn(() => Promise.resolve(7)),
      },
    };
    service = new MessagingCoreService(
      stub<PrismaService>(prisma),
      stub<PresenceService>({}),
      stub<DomainEventService>({}),
      stub<MentionsService>({}),
      stub<BlocksService>({}),
      stub<VerificationAccessService>({}),
      stub<RateLimitService>({}),
    );
    service.resolveConversationId = jest.fn(() => Promise.resolve(GROUP));
  });

  it("builds the card from the group as it is, not from the client's copy", async () => {
    await expect(service.buildGroupInvite('pub-g', ME, THEM)).resolves.toEqual({
      type: 'group_invite',
      groupId: 'pub-g',
      conversationId: 'pub-g',
      groupName: 'Design Crew',
      groupAvatar: 'groups/a.webp',
      description: 'We draw',
      whoCanJoin: 'APPROVAL',
      memberCount: 7,
    });
  });

  it('refuses an inviter who is no longer in the group', async () => {
    rows = [{ userId: ME, leftAt: new Date(), deletedAt: null }];
    await expect(
      service.buildGroupInvite('pub-g', ME, THEM),
    ).rejects.toMatchObject({
      response: { code: 'NOT_A_MEMBER' },
    });
  });

  it('refuses a closed group', async () => {
    conv = { status: 'Closed' };
    await expect(service.buildGroupInvite('pub-g', ME, THEM)).rejects.toThrow(
      'GROUP_CLOSED',
    );
  });

  it('refuses inviting someone already in it', async () => {
    rows.push({ userId: THEM, leftAt: null, deletedAt: null });
    await expect(
      service.buildGroupInvite('pub-g', ME, THEM),
    ).rejects.toMatchObject({
      response: { code: 'ALREADY_MEMBER' },
    });
  });

  it('allows inviting back someone who left', async () => {
    rows.push({ userId: THEM, leftAt: new Date(), deletedAt: null });
    await expect(
      service.buildGroupInvite('pub-g', ME, THEM),
    ).resolves.toMatchObject({
      groupId: 'pub-g',
    });
  });
});

describe('POST /api/dm/invite', () => {
  const dto = (over: Partial<SendGroupInviteDto> = {}) =>
    Object.assign(new SendGroupInviteDto(), {
      targetUserId: THEM,
      groupId: 'pub-g',
      clientId: 'inv-1',
      ...over,
    });

  function build(buildInvite: () => Promise<Record<string, unknown>>) {
    const startDM = jest.fn(() =>
      Promise.resolve({ id: 'dm-1', publicId: 'dm-1' }),
    );
    const sendMessage = jest.fn(
      (_u: string, _c: string, body: { clientId?: string }) =>
        Promise.resolve({
          id: 'msg-1',
          conversationId: 'dm-1',
          publicId: 'dm-1',
          internalId: 'dm-int',
          clientId: body.clientId,
          text: '',
          inviteData: { groupName: 'Design Crew' },
          createdAt: new Date(),
          recipientIds: [THEM],
          unmutedRecipientIds: [],
          senderName: 'Me',
          senderAvatar: '',
          conversationName: '',
        }),
    );
    const controller = new DmController(
      stub<DmService>({
        buildGroupInvite: jest.fn(buildInvite),
        startDM,
        sendMessage,
      }),
      stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
      stub<NotificationsService>({}),
      stub<NotificationFactory>({}),
      stub<BlocksService>({}),
      stub<VerificationAccessService>({}),
    );
    return { controller, startDM, sendMessage };
  }

  it('finds or creates the DM and sends the server-built card in one request', async () => {
    const card = {
      type: 'group_invite',
      groupId: 'pub-g',
      groupName: 'Design Crew',
    };
    const { controller, startDM, sendMessage } = build(() =>
      Promise.resolve(card),
    );
    const res = await controller.sendGroupInvite(req, dto());
    expect(startDM).toHaveBeenCalledWith(ME, THEM);
    expect(sendMessage).toHaveBeenCalledWith(
      ME,
      'dm-1',
      expect.objectContaining({
        text: '',
        inviteData: card,
        clientId: 'inv-1',
      }),
    );
    expect(res).toMatchObject({ id: 'msg-1', clientId: 'inv-1' });
  });

  it('creates no DM when the invite itself is refused', async () => {
    const { controller, startDM, sendMessage } = build(() =>
      Promise.reject(new Error('NOT_A_MEMBER')),
    );
    await expect(controller.sendGroupInvite(req, dto())).rejects.toThrow(
      'NOT_A_MEMBER',
    );
    expect(startDM).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('POST /api/group-chats/:id/join', () => {
  it('answers once the membership and the caches are done, without waiting for the system line', async () => {
    const order: string[] = [];
    const never = new Promise<string>(() => {});
    const service = stub<GroupChatsService>({
      joinGroupByInvite: jest.fn(() =>
        Promise.resolve({
          status: 'JOINED' as const,
          alreadyMember: false,
          role: 'MEMBER',
          conversationId: 'pub-g',
          publicId: 'pub-g',
          internalId: GROUP,
        }),
      ),
      evictMembershipCaches: jest.fn(() => {
        order.push('evict');
        return Promise.resolve();
      }),
      // The system line's lookups never finish: the answer must not wait.
      getUserHandle: jest.fn(() => never),
      getConversationParticipantIds: jest.fn(() => never),
      invalidateGroupDetailsCache: jest.fn(() => Promise.resolve()),
    });
    const controller = new GroupChatsController(
      service,
      stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
      stub<NotificationsService>({}),
      stub<NotificationFactory>({}),
    );
    await expect(controller.joinGroup(req, 'pub-g')).resolves.toMatchObject({
      status: 'JOINED',
    });
    order.push('answered');
    expect(order).toEqual(['evict', 'answered']);
  });
});
