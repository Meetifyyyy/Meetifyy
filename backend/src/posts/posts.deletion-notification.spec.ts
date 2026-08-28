import { NotificationFactory } from '../notifications/notification.factory';
import { PostsService } from './posts.service';

/**
 * The author of removed content gets told — and the notification is fired at
 * the point of deletion, so no caller can route around it.
 */
describe('Content removal notifications', () => {
  const factory = new NotificationFactory();
  const actor = {
    id: 'mod-1',
    username: 'mod',
    displayName: 'Mod Squad',
    avatar: null,
  };

  describe('the notification itself', () => {
    it('tells a post author their post was removed, by role', () => {
      const dto = factory.createContentRemoved(actor, {
        recipientId: 'author-1',
        contentType: 'post',
        removedBy: 'moderator',
        entityId: 'p1',
        postId: 'p1',
        communityId: 'c1',
        communityName: 'Chess Club',
        contentPreview: 'hello everyone',
      });

      expect(dto).toMatchObject({
        recipientId: 'author-1',
        title: 'Your post was removed',
        body: 'Your post in Chess Club was removed by a moderator.',
      });
      expect(dto?.metadata).toMatchObject({
        kind: 'content_removed',
        contentType: 'post',
        removedBy: 'moderator',
        postId: 'p1',
        communityId: 'c1',
      });
    });

    it('distinguishes the owner from a moderator', () => {
      const dto = factory.createContentRemoved(actor, {
        recipientId: 'author-1',
        contentType: 'comment',
        removedBy: 'owner',
        entityId: 'k1',
        postId: 'p1',
        communityName: 'Chess Club',
      });
      expect(dto?.body).toBe(
        'Your comment in Chess Club was removed by the community owner.',
      );
      expect(dto?.metadata).toMatchObject({
        commentId: 'k1',
        contentType: 'comment',
      });
    });

    it('reads sensibly with no community name', () => {
      const dto = factory.createContentRemoved(actor, {
        recipientId: 'author-1',
        contentType: 'post',
        removedBy: 'moderator',
        entityId: 'p1',
      });
      expect(dto?.body).toBe('Your post was removed by a moderator.');
    });

    it('refuses to notify an author about their own deletion', () => {
      // Belt to the delete paths' braces — they already skip this case.
      const dto = factory.createContentRemoved(actor, {
        recipientId: actor.id,
        contentType: 'post',
        removedBy: 'owner',
        entityId: 'p1',
      });
      expect(dto).toBeNull();
    });
  });

  describe('wired into the delete paths', () => {
    const build = ({
      authority,
    }: {
      authority: 'author' | 'owner' | 'moderator';
    }) => {
      const created: any[] = [];
      const prisma: any = {
        post: {
          findUnique: jest.fn(async () => ({
            id: 'p1',
            authorId: 'author-1',
            communityId: 'c1',
            text: 'hi',
            deletedAt: null,
          })),
          update: jest.fn(async () => ({})),
        },
        comment: {
          updateMany: jest.fn(async () => ({})),
          findMany: jest.fn(async () => []),
        },
        postLike: { deleteMany: jest.fn(async () => ({})) },
        postBookmark: { deleteMany: jest.fn(async () => ({})) },
        postShare: { deleteMany: jest.fn(async () => ({})) },
        postHashtag: { deleteMany: jest.fn(async () => ({})) },
        mention: { deleteMany: jest.fn(async () => ({})) },
        commentLike: { deleteMany: jest.fn(async () => ({})) },
        pollVote: { deleteMany: jest.fn(async () => ({})) },
        pollOption: { deleteMany: jest.fn(async () => ({})) },
        media: {
          findMany: jest.fn(async () => []),
          deleteMany: jest.fn(async () => ({})),
        },
        user: { findUnique: jest.fn(async () => actor) },
        community: {
          findUnique: jest.fn(async () => ({ name: 'Chess Club' })),
        },
        // Use the interactive-callback form: call fn(prisma) so the new
        // transaction body executes against the same mock object.
        $transaction: jest.fn(async (fn: any) =>
          typeof fn === 'function' ? fn(prisma) : fn,
        ),
      };

      const notifications: any = {
        createNotification: jest.fn(async (dto: any) => {
          created.push(dto);
        }),
      };
      const authorizer: any = {
        assertCanDelete: jest.fn(async () => authority),
      };
      const service = new PostsService(
        prisma,
        notifications,
        factory,
        {} as any,
        { emit: jest.fn() } as any,
        {} as any,
        {} as any,
        {} as any,
        authorizer,
      );
      return { service, created, notifications, authorizer };
    };

    /** The notification is fire-and-forget, so let the microtasks drain. */
    const settle = () => new Promise((r) => setImmediate(r));

    it('notifies the author when a moderator removes their post', async () => {
      const { service, created } = build({ authority: 'moderator' });
      await service.deletePost('p1', 'mod-1');
      await settle();

      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        recipientId: 'author-1',
        title: 'Your post was removed',
      });
    });

    it('stays silent when authors delete their own post', async () => {
      const { service, created } = build({ authority: 'author' });
      await service.deletePost('p1', 'author-1');
      await settle();
      expect(created).toHaveLength(0);
    });

    it('does not fail the deletion when the notification throws', async () => {
      // The row is already gone by this point; a moderator must not be told
      // the removal failed and retry it.
      const { service, notifications } = build({ authority: 'owner' });
      notifications.createNotification.mockRejectedValue(
        new Error('queue down'),
      );
      await expect(service.deletePost('p1', 'owner-1')).resolves.toMatchObject({
        success: true,
      });
      await settle();
    });

    it('runs the authorizer before deleting anything', async () => {
      const { service, authorizer } = build({ authority: 'moderator' });
      await service.deletePost('p1', 'mod-1');
      expect(authorizer.assertCanDelete).toHaveBeenCalledWith(
        { actorId: 'mod-1', authorId: 'author-1', communityId: 'c1' },
        'post',
      );
    });
  });
});
