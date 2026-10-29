import { ForbiddenException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { GroupChatsService } from './group-chats/group-chats.service';
import { createVerificationAccessMock } from '../common/verification/testing/verification-access.mock';

/**
 * Joining a group is messaging, so it sits behind the selfie gate on every
 * path that adds a member — not only `addMember`:
 *   - joining (or requesting to join) through an invite link;
 *   - an admin approving a join request, which must re-check the REQUESTER
 *     (a request may predate the gate, or the account may have lapsed since).
 * The invite preview stays readable and tells the client to show the verify
 * prompt instead of a Join button.
 *
 * All three live on MessagingCoreService (each service used to carry its own
 * `acceptGroupJoinRequest`); both services are driven here.
 */
const CONV = 'conv-1';
const OWNER = 'owner';
const VERIFIED = 'verified-user';
const UNVERIFIED = 'unverified-user';
/** A live invite link to the group, made by its owner. */
const LINK = { code: 'Abc123Def456' };

function makePrisma(
  opts: { whoCanJoin?: string; status?: string; memberIds?: string[] } = {},
) {
  const members = new Set([OWNER, ...(opts.memberIds ?? [])]);
  const prisma = {
    groupInviteLink: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          conversationId: CONV,
          createdById: OWNER,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
      ),
    },
    conversation: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          id: CONV,
          publicId: 'pub-1',
          name: 'Design Crew',
          avatarKey: null,
          description: null,
          ownerId: OWNER,
          whoCanJoin: opts.whoCanJoin ?? 'ANYONE',
          visibility: 'PUBLIC',
          status: opts.status ?? 'ACTIVE',
          memberCount: 1,
        }),
      ),
    },
    conversationParticipant: {
      // The owner (and any listed member) has a row; anyone else has none.
      findUnique: jest.fn(
        (args: { where: { userId_conversationId: { userId: string } } }) => {
          const id = args.where.userId_conversationId.userId;
          return Promise.resolve(
            members.has(id)
              ? {
                  role: id === OWNER ? 'OWNER' : 'MEMBER',
                  leftAt: null,
                  deletedAt: null,
                  joinedAt: new Date('2026-10-28T10:00:00Z'),
                }
              : null,
          );
        },
      ),
      count: jest.fn(() => Promise.resolve(1)),
      upsert: jest.fn(() => Promise.resolve({})),
      // Read by the cache eviction that follows an accepted request.
      findMany: jest.fn(() => Promise.resolve([])),
    },
    conversationJoinRequest: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          status: 'PENDING',
          expiresAt: null,
          decidedAt: null,
        }),
      ),
      upsert: jest.fn(() => Promise.resolve({})),
      delete: jest.fn(() => Promise.resolve({})),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    // Interactive: the approval runs its writes on the transaction client.
    $transaction: jest.fn(
      (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma),
    ),
  };
  return prisma;
}

type Ops = Pick<
  MessagesService,
  'joinGroupByInvite' | 'acceptGroupJoinRequest' | 'getGroupInvitePreview'
>;

function build<T extends object>(
  proto: T,
  prisma: ReturnType<typeof makePrisma>,
  access: ReturnType<typeof createVerificationAccessMock>,
): T {
  const service = Object.create(proto) as T;
  Object.assign(service, {
    prisma,
    verificationAccess: access,
    resolveConversationId: (id: string) => Promise.resolve(id),
    blocksService: { isBlocked: () => Promise.resolve(false) },
  });
  return service;
}

const services: [string, object][] = [
  ['MessagesService', MessagesService.prototype],
  ['GroupChatsService', GroupChatsService.prototype],
];

describe.each(services)('%s — group join verification', (_name, proto) => {
  let access: ReturnType<typeof createVerificationAccessMock>;
  const make = (prisma: ReturnType<typeof makePrisma>): Ops =>
    build(proto as Ops, prisma, access);

  beforeEach(() => {
    access = createVerificationAccessMock([UNVERIFIED]);
  });

  describe('joinGroupByInvite', () => {
    it('refuses an unverified user joining an open group by link', async () => {
      const prisma = makePrisma();
      await expect(
        make(prisma).joinGroupByInvite(CONV, UNVERIFIED, LINK),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
    });

    it('refuses an unverified user requesting to join an approval group', async () => {
      const prisma = makePrisma({ whoCanJoin: 'APPROVAL' });
      await expect(
        make(prisma).joinGroupByInvite(CONV, UNVERIFIED, LINK),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.conversationJoinRequest.upsert).not.toHaveBeenCalled();
    });

    it('lets a verified user join as before', async () => {
      const prisma = makePrisma();
      const res = await make(prisma).joinGroupByInvite(CONV, VERIFIED, LINK);
      expect(res.status).toBe('JOINED');
      expect(prisma.conversationParticipant.upsert).toHaveBeenCalledTimes(1);
    });

    it('does not gate anyone while enforcement is off', async () => {
      access.isEnforcementEnabled.mockReturnValue(false);
      const prisma = makePrisma();
      const res = await make(prisma).joinGroupByInvite(CONV, UNVERIFIED, LINK);
      expect(res.status).toBe('JOINED');
    });
  });

  describe('acceptGroupJoinRequest', () => {
    it('refuses an unverified requester with 403 and removes the request', async () => {
      const prisma = makePrisma({ whoCanJoin: 'APPROVAL' });
      const err = await make(prisma)
        .acceptGroupJoinRequest(CONV, OWNER, UNVERIFIED)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'JOIN_REQUEST_INELIGIBLE',
      });
      expect(prisma.conversationJoinRequest.delete).toHaveBeenCalledWith({
        where: {
          conversationId_userId: { conversationId: CONV, userId: UNVERIFIED },
        },
      });
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('admits a verified requester, reporting the change and both group ids', async () => {
      const prisma = makePrisma({ whoCanJoin: 'APPROVAL' });
      await expect(
        make(prisma).acceptGroupJoinRequest(CONV, OWNER, VERIFIED),
      ).resolves.toMatchObject({
        success: true,
        changed: true,
        publicId: 'pub-1',
        internalId: CONV,
        membershipChangedAt: expect.any(String) as unknown,
      });
      expect(prisma.conversationParticipant.upsert).toHaveBeenCalledTimes(1);
    });

    it('a second approval (another admin, a double tap) succeeds without a second write', async () => {
      const prisma = makePrisma({
        whoCanJoin: 'APPROVAL',
        memberIds: [VERIFIED],
      });
      await expect(
        make(prisma).acceptGroupJoinRequest(CONV, OWNER, VERIFIED),
      ).resolves.toMatchObject({ success: true, changed: false });
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
    });

    it('a group that has ended takes no one', async () => {
      const prisma = makePrisma({ whoCanJoin: 'APPROVAL', status: 'Closed' });
      await expect(
        make(prisma).acceptGroupJoinRequest(CONV, OWNER, VERIFIED),
      ).rejects.toThrow('GROUP_CLOSED');
      expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getGroupInvitePreview', () => {
    it('stays readable for an unverified user and flags requiresVerification', async () => {
      const res = await make(makePrisma()).getGroupInvitePreview(
        CONV,
        UNVERIFIED,
      );
      expect(res.isMember).toBe(false);
      expect(res.requiresVerification).toBe(true);
    });

    it('does not flag a verified user', async () => {
      const res = await make(makePrisma()).getGroupInvitePreview(
        CONV,
        VERIFIED,
      );
      expect(res.requiresVerification).toBe(false);
    });
  });
});
