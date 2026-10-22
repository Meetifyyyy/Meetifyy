import {
  CommunitiesService,
  JOIN_NOTIFY_REVIEWER_CEILING,
} from './communities.service';
import { Logger } from '@nestjs/common';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { PresenceService } from '../presence/presence.service';
import type { DefaultAssetsService } from '../uploads/default-assets.service';
import type { BlocksService } from '../users/blocks.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import type { CampusAccessService } from '../common/campus/campus-access.service';
import type { CreateNotificationDto } from '../notifications/notification.factory';

/**
 * "X joined your community" / "X requested to join your community" (spec
 * 10C.3): created through the real join paths, after the join committed, for
 * the owner and the moderators who may review requests, and never repeated
 * for a request that was already waiting.
 */
interface StaffQuery {
  where?: { communityId?: string; role?: { in?: string[] } };
  orderBy?: unknown;
  take?: number;
}
const mods = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    userId: `mod${String(i).padStart(3, '0')}`,
    role: 'MODERATOR',
  }));
const flush = () => new Promise((r) => setTimeout(r, 0));
const joiner = {
  id: 'joiner',
  username: 'aarav',
  displayName: 'Aarav',
  avatar: null,
};

function build(opts: {
  isPrivate: boolean;
  isCampusCommunity?: boolean;
  previousRequest?: { status: string } | null;
  alreadyMember?: boolean;
  staff?: { userId: string; role: string }[];
}) {
  const tx = {
    communityMember: {
      findUnique: jest.fn(() =>
        Promise.resolve(opts.alreadyMember ? { role: 'MEMBER' } : null),
      ),
      create: jest.fn(() => Promise.resolve({})),
    },
    community: { update: jest.fn(() => Promise.resolve({ memberCount: 4 })) },
  };
  const prisma = {
    community: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 'k1',
          name: 'Chess Club',
          avatarKey: null,
          deletedAt: null,
          isPrivate: opts.isPrivate,
          isCampusCommunity: opts.isCampusCommunity ?? false,
          collegeId: null,
          ownerId: 'owner',
          memberCount: 3,
          college: null,
        }),
      ),
    },
    communityMember: {
      // The notifier reads the joiner through the membership it just wrote.
      findUnique: jest.fn((args: { select?: { user?: unknown } }) =>
        Promise.resolve(args.select?.user ? { user: joiner } : null),
      ),
      findMany: jest.fn((_args: StaffQuery) =>
        Promise.resolve(
          opts.staff ?? [
            { userId: 'owner', role: 'OWNER' },
            { userId: 'mod', role: 'MODERATOR' },
            { userId: 'joiner', role: 'MODERATOR' },
          ],
        ),
      ),
    },
    communityJoinRequest: {
      findUnique: jest.fn((args: { select?: { user?: unknown } }) =>
        Promise.resolve(
          args.select?.user ? { user: joiner } : (opts.previousRequest ?? null),
        ),
      ),
      upsert: jest.fn(() => Promise.resolve({})),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const createNotification = jest.fn<
    Promise<null>,
    [CreateNotificationDto | null]
  >(() => Promise.resolve(null));
  const service = new CommunitiesService(
    stub<PrismaService>(prisma),
    stub<DomainEventService>({ emit: jest.fn(() => Promise.resolve()) }),
    stub<RedisService>({
      getClient: () => null,
      withLock: <T>(_k: string, _t: number, fn: () => Promise<T>) => fn(),
    }),
    stub<PresenceService>(),
    stub<DefaultAssetsService>(),
    stub<BlocksService>(),
    stub<NotificationsService>({ createNotification }),
    new NotificationFactory(),
    stub<CampusAccessService>(),
  );
  Object.assign(service, {
    invalidateCommunityCache: jest.fn(() => Promise.resolve()),
  });
  return {
    service,
    createNotification,
    tx,
    staffQuery: prisma.communityMember.findMany,
  };
}

describe('community join notifications', () => {
  it('public join notifies the owner and moderators once each, never the joiner', async () => {
    const { service, createNotification } = build({ isPrivate: false });
    await service.joinCommunity('k1', 'joiner');
    await flush();
    const recipients = createNotification.mock.calls
      .map((c) => c[0]?.recipientId)
      .sort();
    expect(recipients).toEqual(['mod', 'owner']);
    expect(createNotification.mock.calls[0][0]).toMatchObject({
      type: 'COMMUNITY_JOIN',
      entityType: 'COMMUNITY',
      entityId: 'k1',
      actorId: 'joiner',
    });
  });

  it('a join that did not happen (already a member) notifies nobody', async () => {
    const { service, createNotification } = build({
      isPrivate: false,
      alreadyMember: true,
    });
    await service.joinCommunity('k1', 'joiner');
    await flush();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('campus communities do not notify on routine joins', async () => {
    const { service, createNotification } = build({
      isPrivate: false,
      isCampusCommunity: true,
    });
    // Campus eligibility needs an affiliation lookup; bypass it for this check.
    Object.assign(service, { resolveCollegeId: () => Promise.resolve(null) });
    await service.joinCommunity('k1', 'joiner').catch(() => undefined);
    await flush();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('a private request notifies reviewers with COMMUNITY_JOIN_REQUEST', async () => {
    const { service, createNotification } = build({ isPrivate: true });
    await service.joinCommunity('k1', 'joiner');
    await flush();
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification.mock.calls[0][0]?.type).toBe(
      'COMMUNITY_JOIN_REQUEST',
    );
  });

  it('pressing Join again on a pending request does not re-notify', async () => {
    const { service, createNotification } = build({
      isPrivate: true,
      previousRequest: { status: 'PENDING' },
    });
    await service.joinCommunity('k1', 'joiner');
    await flush();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('a notification failure never fails the join', async () => {
    const { service, createNotification } = build({ isPrivate: false });
    createNotification.mockRejectedValue(new Error('db down'));
    await expect(service.joinCommunity('k1', 'joiner')).resolves.toMatchObject({
      isJoined: true,
    });
    await flush();
  });

  it('notifies every reviewer on a large team, not an arbitrary 25', async () => {
    const team = mods(60);
    const { service, createNotification } = build({
      isPrivate: false,
      staff: [{ userId: 'owner', role: 'OWNER' }, ...team],
    });
    await service.joinCommunity('k1', 'joiner');
    await flush();
    const recipients = new Set(
      createNotification.mock.calls.map((c) => c[0]?.recipientId),
    );
    expect(recipients.size).toBe(61);
    for (const m of team) expect(recipients.has(m.userId)).toBe(true);
    expect(recipients.has('owner')).toBe(true);
  });

  it('bounds the reviewer read in the query: reviewer roles only, stable order, ceiling + 1', async () => {
    const { service, staffQuery } = build({ isPrivate: false });
    await service.joinCommunity('k1', 'joiner');
    await flush();
    const args = staffQuery.mock.calls[0][0];
    expect(args.where?.communityId).toBe('k1');
    expect([...(args.where?.role?.in ?? [])].sort()).toEqual([
      'MODERATOR',
      'OWNER',
    ]);
    expect(args.orderBy).toEqual([{ joinedAt: 'asc' }, { userId: 'asc' }]);
    expect(args.take).toBe(JOIN_NOTIFY_REVIEWER_CEILING + 1);
  });

  it('logs, rather than silently drops, reviewers past the ceiling', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const { service, createNotification } = build({
        isPrivate: false,
        // What the capped query returns on an oversized team: ceiling + 1 rows.
        staff: mods(JOIN_NOTIFY_REVIEWER_CEILING + 1),
      });
      await service.joinCommunity('k1', 'joiner');
      await flush();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('more than 200 join reviewers'),
      );
      // The ceiling's worth of reviewers plus the owner, who is always told;
      // the extra row read to detect the overflow is not notified.
      const recipients = createNotification.mock.calls.map(
        (c) => c[0]?.recipientId,
      );
      expect(recipients).toHaveLength(JOIN_NOTIFY_REVIEWER_CEILING + 1);
      expect(recipients).toContain('owner');
      expect(recipients).not.toContain(
        `mod${String(JOIN_NOTIFY_REVIEWER_CEILING).padStart(3, '0')}`,
      );
    } finally {
      warn.mockRestore();
    }
  });
});
