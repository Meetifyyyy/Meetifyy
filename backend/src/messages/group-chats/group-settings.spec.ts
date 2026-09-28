import { ForbiddenException } from '@nestjs/common';
import { GroupChatsService } from './group-chats.service';

/**
 * What `PATCH /api/group-chats/:id/settings` may change, and who may change it.
 *
 * Pinned because the handler moved from `data: any` to a typed DTO (pending
 * item A4): the rules below are the ones it had, and the typed version must
 * keep every one of them.
 */
describe('GroupChatsService.updateGroupSettings', () => {
  const CONV = 'conv-internal';

  const build = (role: 'OWNER' | 'ADMIN' | 'MEMBER') => {
    const participantUpdate = jest.fn(() => Promise.resolve({}));
    const conversationUpdate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: CONV, publicId: 'pub-1', ...data }),
    );
    const conversationFind = jest.fn(() =>
      Promise.resolve({ id: CONV, publicId: 'pub-1', whoCanJoin: 'ANYONE' }),
    );

    const service = Object.create(
      GroupChatsService.prototype,
    ) as GroupChatsService;
    Object.assign(service, {
      resolveConversationId: jest.fn(() => Promise.resolve(CONV)),
      invalidateUserConversationsCache: jest.fn(() => Promise.resolve()),
      _invalidateGroupDetailsByRealId: jest.fn(() => Promise.resolve()),
      prisma: {
        conversationParticipant: {
          findUnique: jest.fn(() =>
            Promise.resolve({ role, leftAt: null, deletedAt: null }),
          ),
          update: participantUpdate,
          findMany: jest.fn(() =>
            Promise.resolve([{ userId: 'u1' }, { userId: 'u2' }]),
          ),
        },
        conversation: {
          update: conversationUpdate,
          findUnique: conversationFind,
        },
      },
    });
    return { service, participantUpdate, conversationUpdate, conversationFind };
  };

  it('lets any member switch their own group updates, and touches nothing else', async () => {
    const { service, participantUpdate, conversationUpdate } = build('MEMBER');

    const res = await service.updateGroupSettings('pub-1', 'u1', {
      groupUpdatesActive: false,
    });

    expect(participantUpdate).toHaveBeenCalledWith({
      where: { userId_conversationId: { userId: 'u1', conversationId: CONV } },
      data: { groupUpdatesActive: false },
    });
    expect(conversationUpdate).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      success: true,
      conversationId: CONV,
      participantIds: ['u1', 'u2'],
    });
  });

  it('refuses the admin-only settings to a plain member', async () => {
    const { service, conversationUpdate } = build('MEMBER');

    await expect(
      service.updateGroupSettings('pub-1', 'u1', { whoCanJoin: 'APPROVAL' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(conversationUpdate).not.toHaveBeenCalled();
  });

  it('writes exactly the settings an admin sent', async () => {
    const { service, conversationUpdate } = build('ADMIN');

    const res = await service.updateGroupSettings('pub-1', 'u1', {
      whoCanJoin: 'APPROVAL',
      allowSharing: false,
    });

    expect(conversationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CONV },
        data: { whoCanJoin: 'APPROVAL', allowSharing: false },
      }),
    );
    expect(res.updatedConv).toMatchObject({ whoCanJoin: 'APPROVAL' });
  });

  it('reads the conversation back rather than writing when nothing admin-only was sent', async () => {
    const { service, conversationUpdate, conversationFind } = build('OWNER');

    const res = await service.updateGroupSettings('pub-1', 'u1', {
      groupUpdatesActive: true,
    });

    expect(conversationUpdate).not.toHaveBeenCalled();
    expect(conversationFind).toHaveBeenCalled();
    expect(res.updatedConv).toMatchObject({ publicId: 'pub-1' });
  });
});
