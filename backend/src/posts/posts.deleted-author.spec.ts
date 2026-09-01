import { PostsService } from './posts.service';

/**
 * Posts and comments from an account inside its deletion window.
 *
 * Reported from the live app: after requesting deletion, the account's posts
 * were still fully visible under their real name and avatar, while their
 * profile already 404'd. Posts are deliberately NOT soft-deleted when deletion
 * is requested — recovery has to bring them back untouched — so hiding them is
 * a query concern, and no post query was filtering on the author.
 *
 * Two layers are tested here. The filter keeps those posts out of every read,
 * and the presenter guarantees that a query which forgets the filter leaks a
 * post that should not be visible rather than a deleted person's identity.
 */
describe('PostsService — posts by an unavailable author', () => {
  const live = {
    id: 'u1',
    username: 'sarthak',
    displayName: 'Sarthak Saini',
    avatar: 'avatars/sarthak.jpg',
    isCampusRep: true,
    collegeId: 'c1',
    college: { id: 'c1', name: 'Example University' },
    accountStatus: 'ACTIVE',
    deletedAt: null,
  };

  const present = (author: any) =>
    (PostsService as any).presentAuthor({ id: 'p1', text: 'hello', author });

  describe('the filter', () => {
    it('requires an available author', () => {
      // ANDed into every post read, so the rule lives in one place rather than
      // being repeated at seven call sites and forgotten at the eighth.
      expect((PostsService as any).AVAILABLE_AUTHOR).toEqual({
        author: { deletedAt: null },
      });
    });

    it('keys off deletedAt, so recovery restores posts with no extra step', () => {
      // deletedAt is the column the request stamps and recovery clears. A
      // filter on accountStatus alone would need a second reconciliation pass.
      const filter = (PostsService as any).AVAILABLE_AUTHOR;
      expect(Object.keys(filter.author)).toEqual(['deletedAt']);
    });
  });

  describe('the presenter', () => {
    it('leaves a live author untouched', () => {
      expect(present(live).author).toBe(live);
    });

    it.each(['PENDING_DELETION', 'DELETED'])(
      'substitutes the tombstone for a %s author',
      (accountStatus) => {
        const out = present({ ...live, accountStatus, deletedAt: new Date() });

        expect(out.author.displayName).toBe('Deleted User');
        expect(out.author.avatar).toBeNull();
        expect(out.author.username).not.toBe('sarthak');
        expect(out.author.isDeleted).toBe(true);
        expect(out.author.profileAvailable).toBe(false);
        // No badge on an account that no longer exists.
        expect(out.author.isCampusRep).toBe(false);
        expect(out.author.college).toBeNull();
        // The post's own fields survive — this is identity substitution, not
        // content removal.
        expect(out.text).toBe('hello');
        expect(out.id).toBe('p1');
      },
    );

    it('leaks nothing of the real identity anywhere in the payload', () => {
      const out = present({
        ...live,
        accountStatus: 'PENDING_DELETION',
        deletedAt: new Date(),
      });
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain('Sarthak Saini');
      expect(serialized).not.toContain('sarthak');
      expect(serialized).not.toContain('avatars/');
      expect(serialized).not.toContain('Example University');
    });

    it('passes through a row with no author rather than throwing', () => {
      expect(() => present(null)).not.toThrow();
      expect(() => present(undefined)).not.toThrow();
    });
  });
});
