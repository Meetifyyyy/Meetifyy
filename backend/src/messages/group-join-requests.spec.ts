import { ConflictException, ForbiddenException } from '@nestjs/common';
import { stub } from '../common/testing/stub';
import { allowAllRateLimit } from '../common/rate-limit/testing/rate-limit.mock';
import type { PrismaService } from '../prisma/prisma.service';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { BlocksService } from '../users/blocks.service';
import type { VerificationAccessService } from '../common/verification/verification-access.service';
import type { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { MessagingCoreService } from './core/messaging-core.service';
import {
  INVITE_CODE_LENGTH,
  INVITE_LINK_TTL_MS,
  isInviteCodeShape,
  newInviteCode,
} from './core/group-invite-access';

/**
 * Answering requests to join, the admins' request timeline, and invite links:
 * - an approval moves PENDING → APPROVED in the transaction that adds the
 *   member, and only once (a second admin's approval, or a double tap,
 *   changes nothing); an approval never overrides another admin's decline;
 * - the timeline of requests is the owner's and admins' alone, and is read
 *   from the requests, never written as a message;
 * - a member's invite link is reused while it lasts, made fresh otherwise
 *   (rate limited), and only the owner and admins can reset the group's.
 */
const CONV = 'conv-1';
const owner = { role: 'OWNER', leftAt: null, deletedAt: null };
const admin = { role: 'ADMIN', leftAt: null, deletedAt: null };
const member = { role: 'MEMBER', leftAt: null, deletedAt: null };
const leftAdmin = { role: 'ADMIN', leftAt: new Date(), deletedAt: null };

function core(
  prisma: Record<string, unknown>,
  rateLimit: RateLimitService = allowAllRateLimit(),
) {
  const service = new MessagingCoreService(
    stub<PrismaService>(prisma),
    stub<PresenceService>({}),
    stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
    stub<MentionsService>({}),
    stub<BlocksService>({ isBlocked: () => Promise.resolve(false) }),
    stub<VerificationAccessService>({
      isEnforcementEnabled: () => false,
      getIneligibleUserIds: () => Promise.resolve([]),
    }),
    rateLimit,
  );
  service.resolveConversationId = jest.fn(() => Promise.resolve(CONV));
  const evict = jest
    .spyOn(service, 'evictMembershipCaches')
    .mockResolvedValue(undefined);
  return { service, evict };
}

/** Participant rows by user id: the acting admin and the requester. */
function participants(byUser: Record<string, unknown>) {
  return jest.fn(
    (args: { where: { userId_conversationId: { userId: string } } }) =>
      Promise.resolve(byUser[args.where.userId_conversationId.userId] ?? null),
  );
}

describe('approving a request to join', () => {
  const prismaFor = (opts: {
    approver?: unknown;
    request?: unknown;
    moved?: number;
    after?: unknown;
  }) => {
    const upsert = jest.fn(() => Promise.resolve({}));
    const updateMany = jest.fn(() =>
      Promise.resolve({ count: opts.moved ?? 1 }),
    );
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(opts.request ?? { status: 'PENDING' })
      .mockResolvedValue(opts.after ?? null);
    const prisma = {
      conversation: {
        findFirst: jest.fn(() =>
          Promise.resolve({ id: CONV, publicId: 'pub-1', status: 'ACTIVE' }),
        ),
      },
      conversationParticipant: {
        findUnique: participants({
          admin: 'approver' in opts ? opts.approver : admin,
        }),
        upsert,
      },
      conversationJoinRequest: { findUnique, updateMany, delete: jest.fn() },
      $transaction: jest.fn(
        (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma),
      ),
    };
    return prisma;
  };

  it('moves PENDING → APPROVED and adds the member in one transaction', async () => {
    const prisma = prismaFor({});
    const { service, evict } = core(prisma);

    await expect(
      service.acceptGroupJoinRequest(CONV, 'admin', 'asker'),
    ).resolves.toMatchObject({
      success: true,
      changed: true,
      publicId: 'pub-1',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.conversationJoinRequest.updateMany).toHaveBeenCalledWith({
      where: { conversationId: CONV, userId: 'asker', status: 'PENDING' },
      data: {
        status: 'APPROVED',
        decidedAt: expect.any(Date) as unknown,
        decidedById: 'admin',
      },
    });
    expect(prisma.conversationParticipant.upsert).toHaveBeenCalledTimes(1);
    expect(evict).toHaveBeenCalledWith(CONV, ['asker']);
  });

  it('a second approval racing the first changes nothing and is not announced', async () => {
    // Both read PENDING; the other admin's write landed first.
    const prisma = prismaFor({ moved: 0, after: { status: 'APPROVED' } });
    const { service } = core(prisma);

    await expect(
      service.acceptGroupJoinRequest(CONV, 'admin', 'asker'),
    ).resolves.toMatchObject({ success: true, changed: false });
    expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
  });

  it('an approval racing a decline does not let the person in', async () => {
    const prisma = prismaFor({ moved: 0, after: { status: 'REJECTED' } });
    const { service } = core(prisma);

    const err = await service
      .acceptGroupJoinRequest(CONV, 'admin', 'asker')
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'REQUEST_ALREADY_DECLINED',
    });
    expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();
  });

  it('a request another admin already declined is not approved over it', async () => {
    const prisma = prismaFor({ request: { status: 'REJECTED' } });
    const { service } = core(prisma);

    await expect(
      service.acceptGroupJoinRequest(CONV, 'admin', 'asker'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['a member', member],
    ['an admin who has left', leftAdmin],
    ['someone not in the group', null],
  ])('%s cannot approve', async (_label, approver) => {
    const prisma = prismaFor({ approver });
    const { service } = core(prisma);

    await expect(
      service.acceptGroupJoinRequest(CONV, 'admin', 'asker'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("the admins' timeline of requests to join", () => {
  const rows = [
    {
      id: 'r1',
      status: 'PENDING',
      createdAt: new Date('2026-10-29T08:00:00Z'),
      decidedAt: null,
      user: {
        id: 'asker',
        username: 'asker',
        displayName: 'Asker',
        avatar: null,
        accountStatus: 'ACTIVE',
        deletedAt: null,
      },
      decidedBy: null,
    },
    {
      id: 'r2',
      status: 'REJECTED',
      createdAt: new Date('2026-10-28T08:00:00Z'),
      decidedAt: new Date('2026-10-28T09:00:00Z'),
      user: {
        id: 'gone',
        username: 'gone',
        displayName: 'Gone',
        avatar: null,
        accountStatus: 'DELETED',
        deletedAt: new Date(),
      },
      decidedBy: { username: 'owner' },
    },
  ];

  const prismaFor = (viewer: unknown) => ({
    conversation: {
      findUnique: jest.fn(() => Promise.resolve({ type: 'GROUP' })),
    },
    conversationParticipant: { findUnique: participants({ me: viewer }) },
    conversationJoinRequest: { findMany: jest.fn(() => Promise.resolve(rows)) },
    message: { create: jest.fn(), findMany: jest.fn() },
  });

  it.each([
    ['the owner', owner],
    ['an admin', admin],
  ])('%s reads the requests, never a deleted account', async (_l, viewer) => {
    const prisma = prismaFor(viewer);
    const { items } = await core(prisma).service.getJoinRequestActivity(
      CONV,
      'me',
    );
    expect(items).toEqual([
      {
        id: 'r1',
        kind: 'JOIN_REQUESTED',
        status: 'PENDING',
        createdAt: '2026-10-29T08:00:00.000Z',
        decidedAt: null,
        decidedByUsername: null,
        user: {
          id: 'asker',
          username: 'asker',
          displayName: 'Asker',
          avatar: null,
        },
      },
    ]);
    // Read from the requests, never from (or into) the message table.
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a member', member],
    ['an admin who has left', leftAdmin],
    ['someone not in the group', null],
  ])('%s is refused, and nothing is read', async (_label, viewer) => {
    const prisma = prismaFor(viewer);
    await expect(
      core(prisma).service.getJoinRequestActivity(CONV, 'me'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversationJoinRequest.findMany).not.toHaveBeenCalled();
  });
});

describe('invite links', () => {
  const prismaFor = (opts: {
    viewer?: unknown;
    existing?: unknown;
    status?: string;
  }) => ({
    conversation: {
      findFirst: jest.fn(() =>
        Promise.resolve({ status: opts.status ?? 'ACTIVE' }),
      ),
      findUnique: jest.fn(() => Promise.resolve({ type: 'GROUP' })),
    },
    conversationParticipant: {
      findUnique: participants({
        me: opts.viewer === undefined ? member : opts.viewer,
      }),
    },
    groupInviteLink: {
      findFirst: jest.fn(() => Promise.resolve(opts.existing ?? null)),
      create: jest.fn((args: { data: { code: string; expiresAt: Date } }) =>
        Promise.resolve({
          code: args.data.code,
          expiresAt: args.data.expiresAt,
        }),
      ),
      updateMany: jest.fn(() => Promise.resolve({ count: 3 })),
    },
  });

  it("hands back the member's own link while it has a day or more left", async () => {
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const prisma = prismaFor({
      existing: { code: 'Abc123Def456', expiresAt },
    });
    const rateLimit = allowAllRateLimit();

    await expect(
      core(prisma, rateLimit).service.createInviteLink(CONV, 'me'),
    ).resolves.toEqual({
      code: 'Abc123Def456',
      expiresAt: expiresAt.toISOString(),
    });
    expect(prisma.groupInviteLink.create).not.toHaveBeenCalled();
    // Opening the sheet again costs nothing.
    expect(rateLimit.consume).not.toHaveBeenCalled();
  });

  it('makes a new seven-day link otherwise, charged to the rate limit', async () => {
    const prisma = prismaFor({});
    const rateLimit = allowAllRateLimit();
    const before = Date.now();

    const res = await core(prisma, rateLimit).service.createInviteLink(
      CONV,
      'me',
    );

    expect(isInviteCodeShape(res.code)).toBe(true);
    const ttl = new Date(res.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(INVITE_LINK_TTL_MS - 1000);
    expect(ttl).toBeLessThanOrEqual(INVITE_LINK_TTL_MS + 1000);
    expect(rateLimit.consume).toHaveBeenCalledWith('msg.invitelink.user', 'me');
  });

  it('refuses someone who is not in the group, and a group that has ended', async () => {
    await expect(
      core(prismaFor({ viewer: null })).service.createInviteLink(CONV, 'me'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      core(prismaFor({ status: 'CLOSED' })).service.createInviteLink(
        CONV,
        'me',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only the owner and admins can reset the links, which revokes all of them', async () => {
    const asAdmin = prismaFor({ viewer: admin });
    await expect(
      core(asAdmin).service.resetInviteLinks(CONV, 'me'),
    ).resolves.toEqual({ success: true, revoked: 3 });
    expect(asAdmin.groupInviteLink.updateMany).toHaveBeenCalledWith({
      where: { conversationId: CONV, revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });

    const asMember = prismaFor({ viewer: member });
    await expect(
      core(asMember).service.resetInviteLinks(CONV, 'me'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(asMember.groupInviteLink.updateMany).not.toHaveBeenCalled();
  });

  it('codes are 12 base-62 characters and do not repeat', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => newInviteCode()));
    expect(codes.size).toBe(2000);
    for (const code of codes) {
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect(isInviteCodeShape(code)).toBe(true);
    }
  });
});
