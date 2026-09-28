import { PostsService } from './posts.service';
import { ContentDeletionAuthorizer } from './content-deletion.authorizer';
import { createStudentYearPolicyMock } from '../common/student-year/testing/student-year-policy.mock';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { NotificationFactory } from '../notifications/notification.factory';
import type { BlocksService } from '../users/blocks.service';
import type { DomainEventService } from '../events/domain-event.service';
import type { RedisService } from '../redis/redis.service';
import type { MentionsService } from '../mentions/mentions.service';
import type { StorageService } from '../uploads/uploads.service';

/**
 * A community moderator opening a thread that holds a deleted comment with live
 * replies (pending item A17).
 *
 * The deleted comment survives as a tombstone — its replies still hang off it —
 * and a tombstone carries `authorId: null`. The page asked the authorizer about
 * every row, tombstone included, and for a moderator the authorizer looks up
 * the authors' roles with `userId: { in: authorIds }`. Prisma rejects a null in
 * that list, so the whole page answered 500 — for moderators only, and only in
 * threads with this shape.
 */
describe('comment page — deleted comment with replies, moderator viewer', () => {
  const POST = 'post-1';
  const COMMUNITY = 'c1';
  const MOD = 'mod-1';

  const comment = (over: {
    id: string;
    parentId: string | null;
    authorId: string;
    isDeleted?: boolean;
  }) => ({
    postId: POST,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    text: over.isDeleted ? '' : 'hello',
    isDeleted: false,
    deletedByUser: false,
    removedByOwner: false,
    likeCount: 0,
    mentions: null,
    author: {
      id: over.authorId,
      username: over.authorId,
      displayName: over.authorId,
      avatar: null,
      deletedAt: null,
      accountStatus: 'ACTIVE',
    },
    ...over,
  });

  const build = () => {
    const tombstone = comment({
      id: 'k-root',
      parentId: null,
      authorId: 'member-1',
      isDeleted: true,
    });
    const reply = comment({
      id: 'k-reply',
      parentId: 'k-root',
      authorId: 'member-2',
    });

    const commentFindMany = jest
      .fn()
      .mockResolvedValueOnce([tombstone])
      .mockResolvedValueOnce([reply])
      .mockResolvedValue([]);

    const memberFindMany = jest.fn(
      ({ where }: { where: { userId: string | { in: unknown[] } } }) => {
        if (typeof where.userId === 'string') {
          // The viewer's own memberships.
          return Promise.resolve([
            { communityId: COMMUNITY, role: 'MODERATOR' },
          ]);
        }
        // What Prisma does with `in: [..., null]` on a non-null column.
        if (where.userId.in.includes(null)) {
          return Promise.reject(
            new Error(
              'Argument `in`: Invalid value provided. Expected String.',
            ),
          );
        }
        return Promise.resolve([]);
      },
    );

    const prisma = stub<PrismaService>({
      post: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: POST,
            authorId: 'owner-1',
            communityId: COMMUNITY,
            community: { deletedAt: null },
          }),
        ),
      },
      comment: { findMany: commentFindMany },
      commentLike: { findMany: jest.fn(() => Promise.resolve([])) },
      community: {
        findMany: jest.fn(() =>
          Promise.resolve([{ id: COMMUNITY, ownerId: 'owner-1' }]),
        ),
      },
      communityMember: { findMany: memberFindMany },
    });

    const service = new PostsService(
      prisma,
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>({
        injectBlockFilter: jest.fn((_u: string, where: unknown) =>
          Promise.resolve(where),
        ),
        isBlocked: jest.fn(() => Promise.resolve(false)),
      }),
      stub<DomainEventService>(),
      stub<RedisService>(),
      stub<MentionsService>(),
      stub<StorageService>(),
      new ContentDeletionAuthorizer(prisma),
      createStudentYearPolicyMock(),
    );
    return { service, memberFindMany };
  };

  it('serves the page instead of failing', async () => {
    const { service } = build();
    await expect(service.getComments(POST, MOD)).resolves.toBeDefined();
  });

  it('never offers to delete the tombstone, and still lets the moderator remove the reply', async () => {
    const { service } = build();
    const { comments } = await service.getComments(POST, MOD);

    const byId = new Map(comments.map((c) => [c.id, c.canDelete]));
    expect(byId.get('k-root')).toBe(false);
    expect(byId.get('k-reply')).toBe(true);
  });

  it('asks about real authors only', async () => {
    const { service, memberFindMany } = build();
    await service.getComments(POST, MOD);

    for (const [args] of memberFindMany.mock.calls) {
      if (typeof args.where.userId !== 'string') {
        expect(args.where.userId.in).not.toContain(null);
      }
    }
  });
});
