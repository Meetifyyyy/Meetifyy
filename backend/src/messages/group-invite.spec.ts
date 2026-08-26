import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';

/**
 * Covers every state the invite UI can render. The join path is shared by both
 * MessagesService and GroupChatsService (it lives on MessagingCoreService), so
 * exercising one subclass covers both.
 */
describe('group invites', () => {
  const CONV_ID = '11111111-1111-4111-8111-111111111111';
  const USER_ID = 'user-1';
  const OWNER_ID = 'owner-1';

  let service: MessagesService;
  let prisma: any;
  let blocks: any;

  const group = (over: any = {}) => ({
    id: CONV_ID,
    publicId: 'pub123',
    name: 'Design Crew',
    avatarKey: null,
    description: 'We design things',
    ownerId: OWNER_ID,
    whoCanJoin: 'ANYONE',
    visibility: 'PUBLIC',
    status: 'ACTIVE',
    memberCount: 3,
    type: 'GROUP',
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        {
          provide: PrismaService,
          useValue: (prisma = {
            conversation: { findFirst: jest.fn(), findUnique: jest.fn() },
            conversationParticipant: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn().mockResolvedValue(3),
              upsert: jest.fn().mockResolvedValue({}),
            },
            conversationJoinRequest: {
              findUnique: jest.fn().mockResolvedValue(null),
              upsert: jest.fn().mockResolvedValue({}),
              delete: jest.fn().mockResolvedValue({}),
            },
            message: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
            deletedMessage: { findMany: jest.fn() },
            block: { findFirst: jest.fn() },
            $transaction: jest.fn(),
          }),
        },
        { provide: PresenceService, useValue: { setOnline: jest.fn(), setOffline: jest.fn(), getPresence: jest.fn() } },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: MentionsService,
          useValue: { sanitize: jest.fn().mockResolvedValue([]), persistAndNotify: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: RedisService,
          useValue: { getClient: jest.fn().mockReturnValue(null), getSubClient: jest.fn().mockReturnValue(null) },
        },
        {
          provide: BlocksService,
          useValue: (blocks = {
            isBlocked: jest.fn().mockResolvedValue(false),
            getExcludedUserIds: jest.fn().mockResolvedValue([]),
            getBlockedByUserIds: jest.fn().mockResolvedValue([]),
            invalidateBlockCache: jest.fn(),
          }),
        },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    // resolveConversationId hits the DB and caches; the id mapping itself is
    // covered elsewhere, so it is stubbed to keep these tests on the invite.
    jest.spyOn(service as any, 'resolveConversationId').mockResolvedValue(CONV_ID);
  });

  describe('joinGroupByInvite', () => {
    it('creates a membership for an open group', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      const res = await service.joinGroupByInvite(CONV_ID, USER_ID);

      expect(res.status).toBe('JOINED');
      expect(res.alreadyMember).toBe(false);
      expect(res.publicId).toBe('pub123');
      expect(prisma.conversationParticipant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_conversationId: { userId: USER_ID, conversationId: CONV_ID } },
        }),
      );
    });

    it('is idempotent for an existing member and never writes a second row', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue({
        role: 'MEMBER', leftAt: null, deletedAt: null,
      });

      const res = await service.joinGroupByInvite(CONV_ID, USER_ID);

      expect(res).toMatchObject({ status: 'JOINED', alreadyMember: true, role: 'MEMBER' });
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
      expect(prisma.conversationJoinRequest.upsert).not.toHaveBeenCalled();
    });

    it('revives the row of someone who previously left rather than inserting a duplicate', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue({
        role: 'MEMBER', leftAt: new Date(), deletedAt: null,
      });

      const res = await service.joinGroupByInvite(CONV_ID, USER_ID);

      expect(res.status).toBe('JOINED');
      expect(prisma.conversationParticipant.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.conversationParticipant.upsert.mock.calls[0][0].update).toMatchObject({
        leftAt: null,
        deletedAt: null,
      });
    });

    it('treats a concurrent-join unique violation as success', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      prisma.conversationParticipant.upsert.mockRejectedValue({ code: 'P2002' });

      await expect(service.joinGroupByInvite(CONV_ID, USER_ID)).resolves.toMatchObject({ status: 'JOINED' });
    });

    it('propagates a genuine database failure instead of reporting success', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      prisma.conversationParticipant.upsert.mockRejectedValue(Object.assign(new Error('db down'), { code: 'P1001' }));

      await expect(service.joinGroupByInvite(CONV_ID, USER_ID)).rejects.toThrow('db down');
    });

    it('creates a pending request when the group requires approval', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group({ whoCanJoin: 'APPROVAL' }));
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      const res = await service.joinGroupByInvite(CONV_ID, USER_ID);

      expect(res.status).toBe('PENDING');
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
      expect(prisma.conversationJoinRequest.upsert).toHaveBeenCalled();
    });

    it.each(['Request required', 'APPROVAL_REQUIRED', 'approval'])(
      'treats legacy join-policy spelling %s as approval-required',
      async (spelling) => {
        prisma.conversation.findFirst.mockResolvedValue(group({ whoCanJoin: spelling }));
        prisma.conversationParticipant.findUnique.mockResolvedValue(null);

        await expect(service.joinGroupByInvite(CONV_ID, USER_ID)).resolves.toMatchObject({ status: 'PENDING' });
      },
    );

    it('re-requesting is duplicate-safe', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group({ whoCanJoin: 'APPROVAL' }));
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      await service.joinGroupByInvite(CONV_ID, USER_ID);
      await service.joinGroupByInvite(CONV_ID, USER_ID);

      // upsert keyed on (conversationId, userId) — two calls, still one row.
      expect(prisma.conversationJoinRequest.upsert).toHaveBeenCalledTimes(2);
      for (const call of prisma.conversationJoinRequest.upsert.mock.calls) {
        expect(call[0].where).toEqual({ conversationId_userId: { conversationId: CONV_ID, userId: USER_ID } });
      }
    });

    it('clears a stale join request once the user is admitted', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      await service.joinGroupByInvite(CONV_ID, USER_ID);

      expect(prisma.conversationJoinRequest.delete).toHaveBeenCalled();
    });

    it('rejects a group that does not exist', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      await expect(service.joinGroupByInvite(CONV_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it.each(['CLOSED', 'ENDED', 'CANCELLED', 'EXPIRED'])('rejects a %s group', async (status) => {
      prisma.conversation.findFirst.mockResolvedValue(group({ status }));
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      await expect(service.joinGroupByInvite(CONV_ID, USER_ID)).rejects.toThrow(BadRequestException);
    });

    it('lets an existing member of a closed group through, so the chat stays reachable', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group({ status: 'CLOSED' }));
      prisma.conversationParticipant.findUnique.mockResolvedValue({ role: 'MEMBER', leftAt: null, deletedAt: null });

      await expect(service.joinGroupByInvite(CONV_ID, USER_ID)).resolves.toMatchObject({ alreadyMember: true });
    });

    it('rejects a user blocked by the group owner', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      blocks.isBlocked.mockResolvedValue(true);

      await expect(service.joinGroupByInvite(CONV_ID, USER_ID)).rejects.toThrow(ForbiddenException);
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
    });

    it('rejects a malformed invite with no conversation id', async () => {
      await expect(service.joinGroupByInvite('', USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('refuses an unauthenticated caller', async () => {
      await expect(service.joinGroupByInvite(CONV_ID, '')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getGroupInvitePreview', () => {
    it('is readable by a non-member and reports CAN_JOIN', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID);

      expect(res).toMatchObject({
        name: 'Design Crew',
        publicId: 'pub123',
        isMember: false,
        joinState: 'CAN_JOIN',
        whoCanJoin: 'ANYONE',
        memberCount: 3,
      });
    });

    it('never leaks the member list or messages', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      const res: any = await service.getGroupInvitePreview(CONV_ID, USER_ID);

      expect(res.memberDetails).toBeUndefined();
      expect(res.members).toBeUndefined();
      expect(res.pendingRequests).toBeUndefined();
    });

    it('reports MEMBER for someone already in the group', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group());
      prisma.conversationParticipant.findUnique.mockResolvedValue({ role: 'ADMIN', leftAt: null, deletedAt: null });

      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID);

      expect(res).toMatchObject({ isMember: true, myRole: 'ADMIN', joinState: 'MEMBER' });
    });

    it('reports REQUESTED while a request is live', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group({ whoCanJoin: 'APPROVAL' }));
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      prisma.conversationJoinRequest.findUnique.mockResolvedValue({
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID);
      expect(res.joinState).toBe('REQUESTED');
      expect(res.hasPendingRequest).toBe(true);
    });

    it('ignores an expired request and offers the group again', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group({ whoCanJoin: 'APPROVAL' }));
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      prisma.conversationJoinRequest.findUnique.mockResolvedValue({
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 60_000),
      });

      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID);
      expect(res.joinState).toBe('APPROVAL_REQUIRED');
      expect(res.hasPendingRequest).toBe(false);
    });

    it('reports CLOSED for an ended group', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group({ status: 'ENDED' }));
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);

      expect((await service.getGroupInvitePreview(CONV_ID, USER_ID)).joinState).toBe('CLOSED');
    });

    it('reports BLOCKED ahead of the join policy', async () => {
      prisma.conversation.findFirst.mockResolvedValue(group({ whoCanJoin: 'APPROVAL' }));
      prisma.conversationParticipant.findUnique.mockResolvedValue(null);
      blocks.isBlocked.mockResolvedValue(true);

      expect((await service.getGroupInvitePreview(CONV_ID, USER_ID)).joinState).toBe('BLOCKED');
    });

    it('404s for a DM or a deleted conversation', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      await expect(service.getGroupInvitePreview(CONV_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
