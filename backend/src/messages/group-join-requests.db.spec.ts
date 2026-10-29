import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { stub } from '../common/testing/stub';
import { allowAllRateLimit } from '../common/rate-limit/testing/rate-limit.mock';
import type { PresenceService } from '../presence/presence.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { BlocksService } from '../users/blocks.service';
import type { VerificationAccessService } from '../common/verification/verification-access.service';
import { MessagingCoreService } from './core/messaging-core.service';

/**
 * Invite links and requests to join, against a real Postgres: the conditional
 * writes that decide a race between two admins, the database's own unique
 * constraints, and the promise that a request never becomes a message.
 *
 * Needs a disposable database with every migration applied (the PGlite rig,
 * or a local Postgres), named in BOTH `DATABASE_URL` and
 * `GROUP_JOIN_TEST_DATABASE_URL`, on localhost. Skipped otherwise, so it can
 * never run against a shared database.
 */
const TEST_URL = process.env.GROUP_JOIN_TEST_DATABASE_URL ?? '';
const runnable =
  TEST_URL !== '' &&
  process.env.DATABASE_URL === TEST_URL &&
  /@(127\.0\.0\.1|localhost):\d+\//.test(TEST_URL);
const describeDb = runnable ? describe : describe.skip;

let seq = 0;
const uuid = () => {
  seq += 1;
  const n = (Date.now() % 1e8).toString(16).padStart(8, '0');
  return `${n}-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
};

describeDb('group invites and join requests (database)', () => {
  let prisma: PrismaService;
  let service: MessagingCoreService;

  const user = async (name: string) => {
    const id = uuid();
    await prisma.user.create({
      data: {
        id,
        username: `${name}_${id.slice(-6)}`,
        displayName: name,
        email: `${name}_${id.slice(-6)}@example.test`,
      },
    });
    return id;
  };

  /** A group with an owner and an admin; returns its ids. */
  const groupWith = async (whoCanJoin: 'ANYONE' | 'APPROVAL') => {
    const [owner, admin] = [await user('owner'), await user('admin')];
    const id = uuid();
    await prisma.conversation.create({
      data: {
        id,
        publicId: `g${id.slice(-10)}`,
        type: 'GROUP',
        name: 'Hostel B',
        ownerId: owner,
        whoCanJoin,
        participants: {
          create: [
            { userId: owner, role: 'OWNER' },
            { userId: admin, role: 'ADMIN' },
          ],
        },
      },
    });
    return { id, owner, admin };
  };

  const isMember = async (conversationId: string, userId: string) => {
    const row = await prisma.conversationParticipant.findUnique({
      where: { userId_conversationId: { userId, conversationId } },
      select: { leftAt: true },
    });
    return Boolean(row && !row.leftAt);
  };

  const settle = <T>(p: Promise<T>) =>
    p.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new MessagingCoreService(
      prisma,
      stub<PresenceService>({}),
      stub<DomainEventService>({ emit: () => Promise.resolve() }),
      stub<MentionsService>({}),
      stub<BlocksService>({
        isBlocked: () => Promise.resolve(false),
        filterBlockedUsers: (_viewer: string, ids: string[]) =>
          Promise.resolve(ids),
      }),
      stub<VerificationAccessService>({
        isEnforcementEnabled: () => false,
        getIneligibleUserIds: () => Promise.resolve([]),
      }),
      allowAllRateLimit(),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('two admins approving at once add the member once, and only one approval counts', async () => {
    const g = await groupWith('APPROVAL');
    const asker = await user('asker');
    await prisma.conversationJoinRequest.create({
      data: { conversationId: g.id, userId: asker },
    });

    const [a, b] = await Promise.all([
      service.acceptGroupJoinRequest(g.id, g.owner, asker),
      service.acceptGroupJoinRequest(g.id, g.admin, asker),
    ]);

    expect([a.changed, b.changed].filter(Boolean)).toHaveLength(1);
    expect(await isMember(g.id, asker)).toBe(true);
    expect(
      await prisma.conversationParticipant.count({
        where: { conversationId: g.id, userId: asker },
      }),
    ).toBe(1);
    const request = await prisma.conversationJoinRequest.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: g.id, userId: asker } },
    });
    expect(request.status).toBe('APPROVED');
    expect([g.owner, g.admin]).toContain(request.decidedById);
  });

  it('an approval and a decline at once leave exactly one answer, never a declined member', async () => {
    const g = await groupWith('APPROVAL');
    const asker = await user('asker');
    await prisma.conversationJoinRequest.create({
      data: { conversationId: g.id, userId: asker },
    });

    const [approve, decline] = await Promise.all([
      settle(service.acceptGroupJoinRequest(g.id, g.owner, asker)),
      settle(service.declineGroupJoinRequest(g.id, g.admin, asker)),
    ]);

    const request = await prisma.conversationJoinRequest.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: g.id, userId: asker } },
    });
    const member = await isMember(g.id, asker);
    if (request.status === 'APPROVED') {
      expect(member).toBe(true);
      expect(decline).toMatchObject({ ok: true, value: { changed: false } });
    } else {
      expect(request.status).toBe('REJECTED');
      expect(member).toBe(false);
      expect(approve.ok).toBe(false);
      if (!approve.ok) expect(approve.error).toBeInstanceOf(ConflictException);
    }
  });

  it('a link lets someone into an open group until it expires or is reset', async () => {
    const g = await groupWith('ANYONE');
    const [first, second, third] = [
      await user('first'),
      await user('second'),
      await user('third'),
    ];
    const { code } = await service.createInviteLink(g.id, g.owner);
    // The same member asking again is handed the same link.
    expect((await service.createInviteLink(g.id, g.owner)).code).toBe(code);

    await expect(
      service.joinGroupByInvite(g.id, first, { code }),
    ).resolves.toMatchObject({ status: 'JOINED', alreadyMember: false });

    await prisma.groupInviteLink.update({
      where: { code },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await settle(
      service.joinGroupByInvite(g.id, second, { code }),
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.error).toBeInstanceOf(ForbiddenException);
      expect((expired.error as ForbiddenException).getResponse()).toMatchObject(
        { code: 'INVITE_EXPIRED' },
      );
    }

    const fresh = await prisma.groupInviteLink.update({
      where: { code },
      data: { expiresAt: new Date(Date.now() + 60_000) },
    });
    await service.resetInviteLinks(g.id, g.admin);
    const revoked = await settle(
      service.joinGroupByInvite(g.id, third, { code: fresh.code }),
    );
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect((revoked.error as ForbiddenException).getResponse()).toMatchObject(
        { code: 'INVITE_REVOKED' },
      );
    }
    expect(await isMember(g.id, second)).toBe(false);
    expect(await isMember(g.id, third)).toBe(false);
  });

  it('a request is not a message: no history, no list preview, no unread count', async () => {
    const g = await groupWith('APPROVAL');
    const asker = await user('asker');
    const { code } = await service.createInviteLink(g.id, g.admin);

    await expect(
      service.joinGroupByInvite(g.id, asker, { code }),
    ).resolves.toMatchObject({ status: 'PENDING', newRequest: true });
    // A second tap changes nothing.
    await expect(
      service.joinGroupByInvite(g.id, asker, { code }),
    ).resolves.toMatchObject({ status: 'PENDING', newRequest: false });

    expect(
      await prisma.message.count({ where: { conversationId: g.id } }),
    ).toBe(0);
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: g.id },
      select: { lastMessageId: true, lastMessageText: true },
    });
    expect(conv).toEqual({ lastMessageId: null, lastMessageText: null });
    const unread = await prisma.conversationParticipant.findMany({
      where: { conversationId: g.id },
      select: { unreadCount: true },
    });
    expect(unread.every((p) => p.unreadCount === 0)).toBe(true);
    expect(await isMember(g.id, asker)).toBe(false);

    // The admins see it; the person who asked (not a member) does not.
    const { items } = await service.getJoinRequestActivity(g.id, g.owner);
    expect(items.map((i) => [i.user.id, i.status])).toEqual([
      [asker, 'PENDING'],
    ]);
    await expect(
      service.getJoinRequestActivity(g.id, asker),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
