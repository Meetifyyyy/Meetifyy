import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { DomainEventService } from '../events/domain-event.service';
import { MentionsService } from '../mentions/mentions.service';
import { RedisService } from '../redis/redis.service';
import { BlocksService } from '../users/blocks.service';
import { verificationAccessMockProvider } from '../common/verification/testing/verification-access.mock';
import { allowAllRateLimitProvider } from '../common/rate-limit/testing/rate-limit.mock';

/**
 * Covers every state the invite UI can render. The join path is shared by both
 * MessagesService and GroupChatsService (it lives on MessagingCoreService), so
 * exercising one subclass covers both.
 */
describe('group invites', () => {
  const CONV_ID = '11111111-1111-4111-8111-111111111111';
  const USER_ID = 'user-1';
  const OWNER_ID = 'owner-1';
  const DM_ID = 'dm-1';
  const MSG_ID = 'msg-1';
  const LINK = { code: 'Abc123Def456' };
  const CARD = { messageId: MSG_ID };
  const HOUR = 60 * 60 * 1000;

  type Row = { role?: string; leftAt: Date | null; deletedAt?: Date | null };
  /** Participant rows by `${userId}|${conversationId}`. */
  let rows: Map<string, Row>;
  const setRow = (userId: string, convId: string, row: Row | null) => {
    if (row) rows.set(`${userId}|${convId}`, row);
    else rows.delete(`${userId}|${convId}`);
  };

  const buildPrisma = () => ({
    conversation: { findFirst: jest.fn(), findUnique: jest.fn() },
    conversationParticipant: {
      findUnique: jest.fn(
        (args: {
          where: {
            userId_conversationId: { userId: string; conversationId: string };
          };
        }) => {
          const { userId, conversationId } = args.where.userId_conversationId;
          return Promise.resolve(
            rows.get(`${userId}|${conversationId}`) ?? null,
          );
        },
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(3),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest
        .fn<Promise<unknown>, [Prisma.ConversationParticipantUpsertArgs]>()
        .mockResolvedValue({}),
    },
    conversationJoinRequest: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest
        .fn<Promise<unknown>, [Prisma.ConversationJoinRequestUpsertArgs]>()
        .mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    groupInviteLink: { findUnique: jest.fn() },
    message: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    deletedMessage: { findMany: jest.fn() },
    block: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  });
  const buildBlocks = () => ({
    isBlocked: jest.fn().mockResolvedValue(false),
    filterBlockedUsers: jest.fn((_viewer: string, ids: string[]) =>
      Promise.resolve(ids),
    ),
    getExcludedUserIds: jest.fn().mockResolvedValue([]),
    getBlockedByUserIds: jest.fn().mockResolvedValue([]),
    invalidateBlockCache: jest.fn(),
  });

  let service: MessagesService;
  let prisma: ReturnType<typeof buildPrisma>;
  let blocks: ReturnType<typeof buildBlocks>;

  const group = (over: Record<string, unknown> = {}) => ({
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
  /** A live link to the group, made by its owner. */
  const link = (over: Record<string, unknown> = {}) => ({
    conversationId: CONV_ID,
    createdById: OWNER_ID,
    expiresAt: new Date(Date.now() + 24 * HOUR),
    revokedAt: null,
    ...over,
  });
  /** An invite card the owner sent the user in their DM, an hour ago. */
  const card = (over: Record<string, unknown> = {}) => ({
    conversationId: DM_ID,
    senderId: OWNER_ID,
    createdAt: new Date(Date.now() - HOUR),
    deletedAt: null,
    state: 'NORMAL',
    payload: { inviteData: { type: 'group_invite', groupId: 'pub123' } },
    ...over,
  });
  /** A member row as the preview's member query selects it. */
  const memberRow = (id: string, user: Record<string, unknown> = {}) => ({
    userId: id,
    user: {
      id,
      username: id,
      displayName: id.toUpperCase(),
      avatar: null,
      accountStatus: 'ACTIVE',
      deletedAt: null,
      ...user,
    },
  });

  beforeEach(async () => {
    rows = new Map();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        allowAllRateLimitProvider(),
        verificationAccessMockProvider(),
        MessagesService,
        {
          provide: PrismaService,
          useValue: (prisma = buildPrisma()),
        },
        {
          provide: PresenceService,
          useValue: {
            setOnline: jest.fn(),
            setOffline: jest.fn(),
            getPresence: jest.fn(),
          },
        },
        { provide: DomainEventService, useValue: { emit: jest.fn() } },
        {
          provide: MentionsService,
          useValue: {
            sanitize: jest.fn().mockResolvedValue([]),
            persistAndNotify: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue(null),
            getSubClient: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: BlocksService,
          useValue: (blocks = buildBlocks()),
        },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    // resolveConversationId hits the DB and caches; the id mapping itself is
    // covered elsewhere. Both of the group's ids resolve to it; anything else
    // comes back as given, which is what the real one does for an unknown id.
    jest
      .spyOn(service, 'resolveConversationId')
      .mockImplementation((id: string) =>
        Promise.resolve(id === 'pub123' || id === CONV_ID ? CONV_ID : id),
      );
    jest.spyOn(service, 'evictMembershipCaches').mockResolvedValue(undefined);
    prisma.conversation.findFirst.mockResolvedValue(group());
    prisma.groupInviteLink.findUnique.mockResolvedValue(link());
    prisma.message.findUnique.mockResolvedValue(card());
    // The owner is in the group; the user is in the DM the card was sent in.
    setRow(OWNER_ID, CONV_ID, { role: 'OWNER', leftAt: null, deletedAt: null });
    setRow(USER_ID, DM_ID, { role: 'MEMBER', leftAt: null, deletedAt: null });
  });

  const refusalCode = (err: unknown) =>
    (err as { getResponse(): { code?: string } }).getResponse().code;

  describe('joinGroupByInvite', () => {
    it('creates a membership for an open group through a link', async () => {
      const res = await service.joinGroupByInvite(CONV_ID, USER_ID, LINK);

      expect(res.status).toBe('JOINED');
      expect(res.alreadyMember).toBe(false);
      expect(res.publicId).toBe('pub123');
      expect(prisma.conversationParticipant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_conversationId: { userId: USER_ID, conversationId: CONV_ID },
          },
        }),
      );
    });

    it('creates a membership through an invite card in a chat', async () => {
      await expect(
        service.joinGroupByInvite(CONV_ID, USER_ID, CARD),
      ).resolves.toMatchObject({ status: 'JOINED', alreadyMember: false });
    });

    it('is idempotent for an existing member, who needs no invite', async () => {
      setRow(USER_ID, CONV_ID, {
        role: 'MEMBER',
        leftAt: null,
        deletedAt: null,
      });

      const res = await service.joinGroupByInvite(CONV_ID, USER_ID);

      expect(res).toMatchObject({
        status: 'JOINED',
        alreadyMember: true,
        role: 'MEMBER',
      });
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
      expect(prisma.conversationJoinRequest.upsert).not.toHaveBeenCalled();
    });

    it('gives a member who hid the chat their chat back, without a new join', async () => {
      setRow(USER_ID, CONV_ID, {
        role: 'MEMBER',
        leftAt: null,
        deletedAt: new Date(),
      });

      await expect(
        service.joinGroupByInvite(CONV_ID, USER_ID),
      ).resolves.toMatchObject({ alreadyMember: true });
      expect(prisma.conversationParticipant.update).toHaveBeenCalledWith({
        where: {
          userId_conversationId: { userId: USER_ID, conversationId: CONV_ID },
        },
        data: { deletedAt: null },
      });
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
    });

    it('revives the row of someone who left rather than inserting a duplicate', async () => {
      setRow(USER_ID, CONV_ID, {
        role: 'MEMBER',
        leftAt: new Date(),
        deletedAt: null,
      });

      const res = await service.joinGroupByInvite(CONV_ID, USER_ID, LINK);

      expect(res.status).toBe('JOINED');
      expect(prisma.conversationParticipant.upsert).toHaveBeenCalledTimes(1);
      expect(
        prisma.conversationParticipant.upsert.mock.calls[0][0].update,
      ).toMatchObject({
        leftAt: null,
        deletedAt: null,
      });
    });

    it('treats a concurrent-join unique violation as success', async () => {
      // What Prisma (through the pg adapter) actually throws on a duplicate:
      // verified against the development database, not assumed.
      prisma.conversationParticipant.upsert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.joinGroupByInvite(CONV_ID, USER_ID, LINK),
      ).resolves.toMatchObject({ status: 'JOINED' });
    });

    it('propagates a genuine database failure instead of reporting success', async () => {
      prisma.conversationParticipant.upsert.mockRejectedValue(
        Object.assign(new Error('db down'), { code: 'P1001' }),
      );

      await expect(
        service.joinGroupByInvite(CONV_ID, USER_ID, LINK),
      ).rejects.toThrow('db down');
    });

    describe.each(['ANYONE', 'APPROVAL'])(
      'refuses an unusable invite whatever "Who can join" says (%s)',
      (whoCanJoin) => {
        beforeEach(() => {
          prisma.conversation.findFirst.mockResolvedValue(
            group({ whoCanJoin }),
          );
        });

        const refused = async (ref: unknown, code: string) => {
          const err = await service
            .joinGroupByInvite(CONV_ID, USER_ID, ref as typeof LINK)
            .then(
              () => null,
              (e: unknown) => e,
            );
          expect(err).toBeInstanceOf(ForbiddenException);
          expect(refusalCode(err)).toBe(code);
          expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
          expect(prisma.conversationJoinRequest.upsert).not.toHaveBeenCalled();
        };

        it('no invite at all (the group address)', () =>
          refused(undefined, 'INVITE_REQUIRED'));

        it('an expired link', async () => {
          prisma.groupInviteLink.findUnique.mockResolvedValue(
            link({ expiresAt: new Date(Date.now() - 1000) }),
          );
          await refused(LINK, 'INVITE_EXPIRED');
        });

        it('a link an admin reset', async () => {
          prisma.groupInviteLink.findUnique.mockResolvedValue(
            link({ revokedAt: new Date() }),
          );
          await refused(LINK, 'INVITE_REVOKED');
        });

        it('a link whose creator has left the group', async () => {
          setRow(OWNER_ID, CONV_ID, { role: 'OWNER', leftAt: new Date() });
          await refused(LINK, 'INVITE_REVOKED');
        });

        it('a link to a different group', async () => {
          prisma.groupInviteLink.findUnique.mockResolvedValue(
            link({ conversationId: 'another-group' }),
          );
          await refused(LINK, 'INVITE_INVALID');
        });

        it('a code that names no link', async () => {
          prisma.groupInviteLink.findUnique.mockResolvedValue(null);
          await refused(LINK, 'INVITE_INVALID');
        });

        it('a malformed code, without looking it up', async () => {
          await refused({ code: "x'; DROP" }, 'INVITE_INVALID');
          expect(prisma.groupInviteLink.findUnique).not.toHaveBeenCalled();
        });

        it('a card past its 48 hours, even one that claims a later expiry', async () => {
          prisma.message.findUnique.mockResolvedValue(
            card({
              createdAt: new Date(Date.now() - 49 * HOUR),
              payload: {
                inviteData: {
                  type: 'group_invite',
                  groupId: 'pub123',
                  expiresAt: new Date(
                    Date.now() + 365 * 24 * HOUR,
                  ).toISOString(),
                },
              },
            }),
          );
          await refused(CARD, 'INVITE_EXPIRED');
        });

        it('a card whose sender is no longer in the group', async () => {
          setRow(OWNER_ID, CONV_ID, { role: 'OWNER', leftAt: new Date() });
          await refused(CARD, 'INVITE_REVOKED');
        });

        it('a card from a chat the viewer is not in', async () => {
          setRow(USER_ID, DM_ID, null);
          await refused(CARD, 'INVITE_INVALID');
        });

        it('a card that was unsent', async () => {
          prisma.message.findUnique.mockResolvedValue(
            card({ state: 'UNSENT' }),
          );
          await refused(CARD, 'INVITE_INVALID');
        });

        it('a card for a different group', async () => {
          prisma.message.findUnique.mockResolvedValue(
            card({
              payload: {
                inviteData: { type: 'group_invite', groupId: 'other' },
              },
            }),
          );
          await refused(CARD, 'INVITE_INVALID');
        });
      },
    );

    it('creates a pending request when the group requires approval, and nothing else', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ whoCanJoin: 'APPROVAL' }),
      );

      const res = await service.joinGroupByInvite(CONV_ID, USER_ID, CARD);

      expect(res).toMatchObject({ status: 'PENDING', newRequest: true });
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
      expect(prisma.conversationJoinRequest.upsert).toHaveBeenCalledTimes(1);
      // A request is not a message: nothing reaches the group's history,
      // its list preview or anyone's unread count.
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it.each(['Request required', 'APPROVAL_REQUIRED', 'approval'])(
      'treats legacy join-policy spelling %s as approval-required',
      async (spelling) => {
        prisma.conversation.findFirst.mockResolvedValue(
          group({ whoCanJoin: spelling }),
        );

        await expect(
          service.joinGroupByInvite(CONV_ID, USER_ID, LINK),
        ).resolves.toMatchObject({ status: 'PENDING' });
      },
    );

    it('re-requesting while a request waits writes nothing and tells no one again', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ whoCanJoin: 'APPROVAL' }),
      );
      prisma.conversationJoinRequest.findUnique.mockResolvedValue({
        status: 'PENDING',
        decidedAt: null,
      });
      // Even once the invite it came through has expired.
      prisma.groupInviteLink.findUnique.mockResolvedValue(
        link({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.joinGroupByInvite(CONV_ID, USER_ID, LINK),
      ).resolves.toMatchObject({ status: 'PENDING', newRequest: false });
      expect(prisma.conversationJoinRequest.upsert).not.toHaveBeenCalled();
    });

    it('a declined person cannot ask again within 24 hours', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ whoCanJoin: 'APPROVAL' }),
      );
      const decidedAt = new Date(Date.now() - 2 * HOUR);
      prisma.conversationJoinRequest.findUnique.mockResolvedValue({
        status: 'REJECTED',
        decidedAt,
      });

      const err = await service.joinGroupByInvite(CONV_ID, USER_ID, LINK).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        code: 'REQUEST_DECLINED',
        retryAt: new Date(decidedAt.getTime() + 24 * HOUR).toISOString(),
      });
      expect(prisma.conversationJoinRequest.upsert).not.toHaveBeenCalled();
    });

    it('a declined person may ask again after 24 hours', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ whoCanJoin: 'APPROVAL' }),
      );
      prisma.conversationJoinRequest.findUnique.mockResolvedValue({
        status: 'REJECTED',
        decidedAt: new Date(Date.now() - 25 * HOUR),
      });

      await expect(
        service.joinGroupByInvite(CONV_ID, USER_ID, LINK),
      ).resolves.toMatchObject({ status: 'PENDING', newRequest: true });
    });

    it('answers a request left from before the group opened up', async () => {
      await service.joinGroupByInvite(CONV_ID, USER_ID, LINK);

      expect(prisma.conversationJoinRequest.updateMany).toHaveBeenCalledWith({
        where: { conversationId: CONV_ID, userId: USER_ID, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          decidedAt: expect.any(Date) as unknown,
          decidedById: null,
        },
      });
    });

    it('rejects a group that does not exist', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      await expect(
        service.joinGroupByInvite(CONV_ID, USER_ID, LINK),
      ).rejects.toThrow(NotFoundException);
    });

    it.each(['CLOSED', 'ENDED', 'CANCELLED', 'EXPIRED'])(
      'rejects a %s group',
      async (status) => {
        prisma.conversation.findFirst.mockResolvedValue(group({ status }));
        await expect(
          service.joinGroupByInvite(CONV_ID, USER_ID, LINK),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('lets an existing member of a closed group through, so the chat stays reachable', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ status: 'CLOSED' }),
      );
      setRow(USER_ID, CONV_ID, {
        role: 'MEMBER',
        leftAt: null,
        deletedAt: null,
      });

      await expect(
        service.joinGroupByInvite(CONV_ID, USER_ID),
      ).resolves.toMatchObject({ alreadyMember: true });
    });

    it('rejects a user blocked by the group owner', async () => {
      blocks.isBlocked.mockResolvedValue(true);

      await expect(
        service.joinGroupByInvite(CONV_ID, USER_ID, LINK),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
    });

    it('rejects a malformed invite with no conversation id', async () => {
      await expect(service.joinGroupByInvite('', USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses an unauthenticated caller', async () => {
      await expect(service.joinGroupByInvite(CONV_ID, '')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getGroupInvitePreview', () => {
    beforeEach(() => {
      prisma.conversationParticipant.findMany.mockResolvedValue([
        memberRow(OWNER_ID),
        memberRow('admin-1'),
        memberRow('m-1'),
      ]);
    });

    it('is readable by a non-member with a live invite, and reports CAN_JOIN', async () => {
      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID, LINK);

      expect(res).toMatchObject({
        name: 'Design Crew',
        publicId: 'pub123',
        isMember: false,
        joinState: 'CAN_JOIN',
        whoCanJoin: 'ANYONE',
        memberCount: 3,
        invite: { status: 'VALID' },
      });
      expect(res.memberPreview.map((m) => m.id)).toEqual([
        OWNER_ID,
        'admin-1',
        'm-1',
      ]);
    });

    it('reports APPROVAL_REQUIRED for an approval group', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ whoCanJoin: 'APPROVAL' }),
      );
      expect(
        (await service.getGroupInvitePreview(CONV_ID, USER_ID, CARD)).joinState,
      ).toBe('APPROVAL_REQUIRED');
    });

    it.each(['ANYONE', 'APPROVAL'])(
      'an expired invite shows the group but no action, whatever the policy (%s)',
      async (whoCanJoin) => {
        prisma.conversation.findFirst.mockResolvedValue(group({ whoCanJoin }));
        prisma.groupInviteLink.findUnique.mockResolvedValue(
          link({ expiresAt: new Date(Date.now() - 1000) }),
        );

        const res = await service.getGroupInvitePreview(CONV_ID, USER_ID, LINK);
        expect(res.joinState).toBe('INVITE_EXPIRED');
        expect(res.invite.status).toBe('EXPIRED');
        // The person was really given this invite: the group is still shown.
        expect(res.memberPreview).toHaveLength(3);
        expect(res.name).toBe('Design Crew');
      },
    );

    it("the group's bare address reads as expired and names no members", async () => {
      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID);
      expect(res.joinState).toBe('INVITE_EXPIRED');
      expect(res.invite.status).toBe('NONE');
      expect(res.memberPreview).toEqual([]);
      expect(prisma.conversationParticipant.findMany).not.toHaveBeenCalled();
    });

    it('a revoked link names no members', async () => {
      prisma.groupInviteLink.findUnique.mockResolvedValue(
        link({ revokedAt: new Date() }),
      );
      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID, LINK);
      expect(res.joinState).toBe('INVITE_REVOKED');
      expect(res.memberPreview).toEqual([]);
    });

    it('never leaks the member list, requests or messages', async () => {
      const res = (await service.getGroupInvitePreview(
        CONV_ID,
        USER_ID,
        LINK,
      )) as unknown as Record<string, unknown>;

      expect(res.memberDetails).toBeUndefined();
      expect(res.members).toBeUndefined();
      expect(res.pendingRequests).toBeUndefined();
      expect(res.messages).toBeUndefined();
    });

    it('shows at most five members, never a deleted account or a blocked one', async () => {
      prisma.conversationParticipant.findMany.mockResolvedValue([
        memberRow(OWNER_ID),
        memberRow('gone', { deletedAt: new Date() }),
        memberRow('blocked'),
        memberRow('a'),
        memberRow('b'),
        memberRow('c'),
        memberRow('d'),
        memberRow('e'),
      ]);
      blocks.filterBlockedUsers.mockImplementation(
        (_viewer: string, ids: string[]) =>
          Promise.resolve(ids.filter((id) => id !== 'blocked')),
      );

      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID, LINK);
      expect(res.memberPreview.map((m) => m.id)).toEqual([
        OWNER_ID,
        'a',
        'b',
        'c',
        'd',
      ]);
    });

    it('reports MEMBER for someone already in the group, with no invite needed', async () => {
      setRow(USER_ID, CONV_ID, {
        role: 'ADMIN',
        leftAt: null,
        deletedAt: null,
      });

      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID);

      expect(res).toMatchObject({
        isMember: true,
        myRole: 'ADMIN',
        joinState: 'MEMBER',
      });
      expect(res.memberPreview).toHaveLength(3);
    });

    it('reports REQUESTED while a request waits, even after the invite expired', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ whoCanJoin: 'APPROVAL' }),
      );
      prisma.conversationJoinRequest.findUnique.mockResolvedValue({
        status: 'PENDING',
        decidedAt: null,
      });
      prisma.groupInviteLink.findUnique.mockResolvedValue(
        link({ expiresAt: new Date(Date.now() - 1000) }),
      );

      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID, LINK);
      expect(res.joinState).toBe('REQUESTED');
      expect(res.hasPendingRequest).toBe(true);
    });

    it('reports REJECTED, with when they may ask again, for 24 hours', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ whoCanJoin: 'APPROVAL' }),
      );
      const decidedAt = new Date(Date.now() - HOUR);
      prisma.conversationJoinRequest.findUnique.mockResolvedValue({
        status: 'REJECTED',
        decidedAt,
      });

      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID, LINK);
      expect(res.joinState).toBe('REJECTED');
      expect(res.retryAt).toBe(
        new Date(decidedAt.getTime() + 24 * HOUR).toISOString(),
      );

      prisma.conversationJoinRequest.findUnique.mockResolvedValue({
        status: 'REJECTED',
        decidedAt: new Date(Date.now() - 25 * HOUR),
      });
      expect(
        (await service.getGroupInvitePreview(CONV_ID, USER_ID, LINK)).joinState,
      ).toBe('APPROVAL_REQUIRED');
    });

    it('reports CLOSED for an ended group', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ status: 'ENDED' }),
      );

      expect(
        (await service.getGroupInvitePreview(CONV_ID, USER_ID, LINK)).joinState,
      ).toBe('CLOSED');
    });

    it('reports BLOCKED ahead of the join policy, and names no members', async () => {
      prisma.conversation.findFirst.mockResolvedValue(
        group({ whoCanJoin: 'APPROVAL' }),
      );
      blocks.isBlocked.mockResolvedValue(true);

      const res = await service.getGroupInvitePreview(CONV_ID, USER_ID, LINK);
      expect(res.joinState).toBe('BLOCKED');
      expect(res.memberPreview).toEqual([]);
    });

    it('404s for a DM or a deleted conversation', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      await expect(
        service.getGroupInvitePreview(CONV_ID, USER_ID, LINK),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getInviteLinkPreview', () => {
    it('opens the group a code belongs to, as a link invite', async () => {
      prisma.groupInviteLink.findUnique.mockResolvedValue(link());
      const res = await service.getInviteLinkPreview(LINK.code, USER_ID);
      expect(res).toMatchObject({
        publicId: 'pub123',
        joinState: 'CAN_JOIN',
        invite: { status: 'VALID' },
      });
    });

    it('a code that names no link (or a deleted group) is INVITE_INVALID', async () => {
      prisma.groupInviteLink.findUnique.mockResolvedValue(null);
      const err = await service.getInviteLinkPreview(LINK.code, USER_ID).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NotFoundException);
      expect(refusalCode(err)).toBe('INVITE_INVALID');
    });

    it('a malformed code is refused without a lookup', async () => {
      await expect(
        service.getInviteLinkPreview('../../etc', USER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.groupInviteLink.findUnique).not.toHaveBeenCalled();
    });
  });
});
