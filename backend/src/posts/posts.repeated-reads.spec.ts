import { NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { ContentDeletionAuthorizer } from './content-deletion.authorizer';
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
 * One call must not read the same thing twice.
 *
 * Opening a post used to read the Post table three times (the ETag meta, the
 * community lookup behind the comment page, the full read) and ask the deletion
 * authorizer twice, which in a community is two reads of the community and of
 * the viewer's membership. The comment list read the post twice. The answers
 * are asserted alongside the counts: fewer reads must not change who is
 * refused or what `canDelete` says.
 */
describe('PostsService — post and comment reads do not repeat', () => {
  const POST = 'post-1';
  const COMMUNITY = 'c1';
  const OWNER = 'owner-1';
  const MEMBER = 'member-1';

  const comment = (id: string, authorId: string) => ({
    id,
    postId: POST,
    parentId: null,
    authorId,
    text: 'hi',
    mentions: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    likeCount: 0,
    isDeleted: false,
    deletedByUser: false,
    removedByOwner: false,
    author: {
      id: authorId,
      username: authorId,
      displayName: authorId,
      avatar: null,
      deletedAt: null,
      accountStatus: 'ACTIVE',
    },
  });

  const communityRow = {
    id: COMMUNITY,
    name: 'C',
    slug: 'c',
    avatarKey: null,
    color: null,
    isPrivate: false,
    isCampusCommunity: false,
    collegeId: null,
    deletedAt: null,
    ownerId: OWNER,
    members: [] as Array<{ userId: string }>,
  };

  const build = (opts: { communityId: string | null }) => {
    const { communityId } = opts;
    const community = communityId ? communityRow : null;
    const postRow = {
      id: POST,
      authorId: MEMBER,
      communityId,
      deletedAt: null,
      text: 'a post',
      likeCount: 0,
      commentCount: 1,
      pollOptions: [],
      pollVotes: [],
      author: {
        id: MEMBER,
        username: 'm',
        displayName: 'm',
        avatar: null,
        deletedAt: null,
        accountStatus: 'ACTIVE',
      },
      community,
    };
    const prisma = {
      post: {
        findUnique: jest.fn((_args?: unknown) => Promise.resolve(postRow)),
        findFirst: jest.fn((_args?: unknown) => Promise.resolve(postRow)),
      },
      media: { findMany: jest.fn(() => Promise.resolve([])) },
      comment: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([comment('k1', 'someone-else')])
          .mockResolvedValue([]),
      },
      commentLike: { findMany: jest.fn(() => Promise.resolve([])) },
      postLike: { findUnique: jest.fn(() => Promise.resolve(null)) },
      postBookmark: { findUnique: jest.fn(() => Promise.resolve(null)) },
      community: {
        findMany: jest.fn(() =>
          Promise.resolve(community ? [{ id: COMMUNITY, ownerId: OWNER }] : []),
        ),
      },
      communityMember: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const service = new PostsService(
      stub<PrismaService>(prisma),
      stub<NotificationsService>(),
      stub<NotificationFactory>(),
      stub<BlocksService>({
        getExcludedUserIds: () => Promise.resolve([]),
        isBlocked: () => Promise.resolve(false),
        injectBlockFilter: <T extends object>(_u: string, w: T) =>
          Promise.resolve(w),
      }),
      stub<DomainEventService>({ emit: jest.fn() }),
      stub<RedisService>(),
      stub<MentionsService>(),
      stub<StorageService>(),
      new ContentDeletionAuthorizer(stub<PrismaService>(prisma)),
    );
    return { service, prisma };
  };

  describe('getComments', () => {
    it('reads the post once and takes the community for canDelete from that read', async () => {
      const { service, prisma } = build({ communityId: COMMUNITY });
      const { comments } = await service.getComments(POST, OWNER);

      expect(prisma.post.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.post.findUnique.mock.calls[0][0]).toMatchObject({
        select: { communityId: true },
      });
      // The owner of the community may remove someone else's comment: that
      // answer needs the community, so it proves the id was passed down.
      expect(comments.map((c) => [c.id, c.canDelete])).toEqual([['k1', true]]);
      expect(prisma.community.findMany).toHaveBeenCalledTimes(1);
    });

    it('answers canDelete false for a viewer with no moderation rights', async () => {
      const { service } = build({ communityId: COMMUNITY });
      const { comments } = await service.getComments(POST, 'bystander');
      expect(comments.map((c) => c.canDelete)).toEqual([false]);
    });

    it('treats a personal post as having no community, with no lookup to find out', async () => {
      const { service, prisma } = build({ communityId: null });
      const { comments } = await service.getComments(POST, OWNER);
      expect(comments.map((c) => c.canDelete)).toEqual([false]);
      expect(prisma.post.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.community.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getPostById', () => {
    it('reads the post row once, with no separate community lookup for the comments', async () => {
      const { service, prisma } = build({ communityId: COMMUNITY });
      await service.getPostById(POST, OWNER);
      expect(prisma.post.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.post.findUnique).not.toHaveBeenCalled();
    });

    it('asks the authorizer once for the comments and the post together', async () => {
      const { service, prisma } = build({ communityId: COMMUNITY });
      const result = await service.getPostById(POST, OWNER);

      // Once, not once per list: a community is read one time, not two.
      expect(prisma.community.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.communityMember.findMany).toHaveBeenCalledTimes(1);
      // The community owner may delete the post and the comment under it.
      expect(result.canDelete).toBe(true);
      expect(result.comments.map((c) => [c.id, c.canDelete])).toEqual([
        ['k1', true],
      ]);
    });

    it('keeps the answers apart: the post author deletes their post but not the comment under it', async () => {
      const { service } = build({ communityId: COMMUNITY });
      const result = await service.getPostById(POST, MEMBER);
      expect(result.canDelete).toBe(true);
      expect(result.comments.map((c) => c.canDelete)).toEqual([false]);
    });

    it('hands the authorizer the comments first and the post last', async () => {
      const { service, prisma } = build({ communityId: null });
      const authorizer = jest.spyOn(
        ContentDeletionAuthorizer.prototype,
        'canDeleteEach',
      );
      try {
        await service.getPostById(POST, OWNER);
        expect(authorizer).toHaveBeenCalledTimes(1);
        expect(authorizer.mock.calls[0][1]).toEqual([
          { authorId: 'someone-else', communityId: null },
          { authorId: MEMBER, communityId: null },
        ]);
        expect(prisma.community.findMany).not.toHaveBeenCalled();
      } finally {
        authorizer.mockRestore();
      }
    });

    it('does not consult the authorizer for a post the viewer may not see', async () => {
      const { service, prisma } = build({ communityId: COMMUNITY });
      prisma.post.findFirst.mockResolvedValueOnce(null as never);
      const authorizer = jest.spyOn(
        ContentDeletionAuthorizer.prototype,
        'canDeleteEach',
      );
      try {
        await expect(service.getPostById(POST, OWNER)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(authorizer).not.toHaveBeenCalled();
      } finally {
        authorizer.mockRestore();
      }
    });
  });
});
