import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentDeletionAuthorizer } from './content-deletion.authorizer';
import { PrismaService } from '../prisma/prisma.service';

describe('ContentDeletionAuthorizer', () => {
  let authorizer: ContentDeletionAuthorizer;

  const mockPrisma = {
    communityMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    community: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ContentDeletionAuthorizer,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    authorizer = module.get(ContentDeletionAuthorizer);
    jest.clearAllMocks();
  });

  // ── resolveRole ───────────────────────────────────────────────────────────

  describe('resolveRole', () => {
    const communityId = 'comm-1';

    it('returns OWNER when userId matches ownerId (even without membership row)', async () => {
      // Membership query should not be needed
      const role = await authorizer.resolveRole(
        'owner-1',
        communityId,
        'owner-1',
      );
      expect(role).toBe('OWNER');
      expect(mockPrisma.communityMember.findUnique).not.toHaveBeenCalled();
    });

    it('returns the membership role when found', async () => {
      mockPrisma.communityMember.findUnique.mockResolvedValue({
        role: 'MODERATOR',
      });
      const role = await authorizer.resolveRole(
        'mod-1',
        communityId,
        'owner-1',
      );
      expect(role).toBe('MODERATOR');
    });

    it('returns MEMBER when no membership row exists', async () => {
      mockPrisma.communityMember.findUnique.mockResolvedValue(null);
      const role = await authorizer.resolveRole(
        'stranger',
        communityId,
        'owner-1',
      );
      expect(role).toBe('MEMBER');
    });

    it('returns OWNER even when a MEMBER membership row exists (community.ownerId wins)', async () => {
      // The owner may have a stale MEMBER row; ownerId takes precedence.
      mockPrisma.communityMember.findUnique.mockResolvedValue({
        role: 'MEMBER',
      });
      const role = await authorizer.resolveRole(
        'owner-1',
        communityId,
        'owner-1',
      );
      expect(role).toBe('OWNER');
    });
  });

  // ── resolveAuthority ──────────────────────────────────────────────────────

  describe('resolveAuthority', () => {
    it('returns "author" when the actor is also the content author', async () => {
      const result = await authorizer.resolveAuthority({
        actorId: 'user-1',
        authorId: 'user-1',
        communityId: null,
      });
      expect(result).toBe('author');
      expect(mockPrisma.community.findUnique).not.toHaveBeenCalled();
    });

    it('returns null for a personal (non-community) post that belongs to someone else', async () => {
      const result = await authorizer.resolveAuthority({
        actorId: 'actor',
        authorId: 'author',
        communityId: null,
      });
      expect(result).toBeNull();
    });

    it('returns null when community does not exist', async () => {
      mockPrisma.community.findUnique.mockResolvedValue(null);
      const result = await authorizer.resolveAuthority({
        actorId: 'actor',
        authorId: 'author',
        communityId: 'comm-gone',
      });
      expect(result).toBeNull();
    });

    it('returns null when community is soft-deleted', async () => {
      mockPrisma.community.findUnique.mockResolvedValue({
        id: 'comm-1',
        ownerId: 'owner-1',
        deletedAt: new Date(),
      });
      const result = await authorizer.resolveAuthority({
        actorId: 'owner-1',
        authorId: 'author',
        communityId: 'comm-1',
      });
      expect(result).toBeNull();
    });

    it('returns "owner" when actor is the community owner', async () => {
      mockPrisma.community.findUnique.mockResolvedValue({
        id: 'comm-1',
        ownerId: 'owner-1',
        deletedAt: null,
      });
      const result = await authorizer.resolveAuthority({
        actorId: 'owner-1',
        authorId: 'member-1',
        communityId: 'comm-1',
      });
      expect(result).toBe('owner');
    });

    it('returns "moderator" when actor is a moderator and author is a MEMBER', async () => {
      mockPrisma.community.findUnique.mockResolvedValue({
        id: 'comm-1',
        ownerId: 'owner-1',
        deletedAt: null,
      });
      // Actor is MODERATOR
      mockPrisma.communityMember.findUnique
        .mockResolvedValueOnce({ role: 'MODERATOR' }) // actor role
        .mockResolvedValueOnce({ role: 'MEMBER' }); // author role
      const result = await authorizer.resolveAuthority({
        actorId: 'mod-1',
        authorId: 'member-1',
        communityId: 'comm-1',
      });
      expect(result).toBe('moderator');
    });

    it('returns null when actor is MODERATOR but author is also a MODERATOR', async () => {
      mockPrisma.community.findUnique.mockResolvedValue({
        id: 'comm-1',
        ownerId: 'owner-1',
        deletedAt: null,
      });
      mockPrisma.communityMember.findUnique
        .mockResolvedValueOnce({ role: 'MODERATOR' }) // actor
        .mockResolvedValueOnce({ role: 'MODERATOR' }); // author
      const result = await authorizer.resolveAuthority({
        actorId: 'mod-1',
        authorId: 'mod-2',
        communityId: 'comm-1',
      });
      expect(result).toBeNull();
    });

    it('returns null when actor is MODERATOR but author is the OWNER', async () => {
      mockPrisma.community.findUnique.mockResolvedValue({
        id: 'comm-1',
        ownerId: 'owner-1',
        deletedAt: null,
      });
      mockPrisma.communityMember.findUnique.mockResolvedValueOnce({
        role: 'MODERATOR',
      }); // actor's role query
      // author is owner — resolveRole checks ownerId first, no DB call needed
      const result = await authorizer.resolveAuthority({
        actorId: 'mod-1',
        authorId: 'owner-1',
        communityId: 'comm-1',
      });
      expect(result).toBeNull();
    });

    it('returns null when actor is an ordinary MEMBER', async () => {
      mockPrisma.community.findUnique.mockResolvedValue({
        id: 'comm-1',
        ownerId: 'owner-1',
        deletedAt: null,
      });
      mockPrisma.communityMember.findUnique.mockResolvedValue({
        role: 'MEMBER',
      });
      const result = await authorizer.resolveAuthority({
        actorId: 'member-1',
        authorId: 'member-2',
        communityId: 'comm-1',
      });
      expect(result).toBeNull();
    });
  });

  // ── canDeleteEach ─────────────────────────────────────────────────────────

  describe('canDeleteEach', () => {
    it('returns all-false when actorId is undefined', async () => {
      const result = await authorizer.canDeleteEach(undefined, [
        { authorId: 'a', communityId: null },
        { authorId: 'b', communityId: 'c-1' },
      ]);
      expect(result).toEqual([false, false]);
    });

    it('returns true for items the actor authored themselves', async () => {
      mockPrisma.community.findMany.mockResolvedValue([]);
      mockPrisma.communityMember.findMany.mockResolvedValue([]);
      const result = await authorizer.canDeleteEach('actor-1', [
        { authorId: 'actor-1', communityId: null },
        { authorId: 'actor-1', communityId: 'comm-1' },
      ]);
      expect(result).toEqual([true, true]);
    });

    it('returns false for a non-author on a personal post (no community)', async () => {
      mockPrisma.community.findMany.mockResolvedValue([]);
      mockPrisma.communityMember.findMany.mockResolvedValue([]);
      const result = await authorizer.canDeleteEach('actor-1', [
        { authorId: 'other', communityId: null },
      ]);
      expect(result).toEqual([false]);
    });

    it('returns true for community owner over any post', async () => {
      mockPrisma.community.findMany.mockResolvedValue([
        { id: 'comm-1', ownerId: 'actor-1' },
      ]);
      mockPrisma.communityMember.findMany.mockResolvedValue([]);
      const result = await authorizer.canDeleteEach('actor-1', [
        { authorId: 'someone-else', communityId: 'comm-1' },
      ]);
      expect(result).toEqual([true]);
    });

    it('returns true when actor is moderator and author is a MEMBER', async () => {
      mockPrisma.community.findMany.mockResolvedValue([
        { id: 'comm-1', ownerId: 'owner-1' },
      ]);
      // Actor's membership
      mockPrisma.communityMember.findMany
        .mockResolvedValueOnce([{ communityId: 'comm-1', role: 'MODERATOR' }]) // actor's memberships
        .mockResolvedValueOnce([
          { communityId: 'comm-1', userId: 'member-1', role: 'MEMBER' },
        ]); // author roles
      const result = await authorizer.canDeleteEach('mod-1', [
        { authorId: 'member-1', communityId: 'comm-1' },
      ]);
      expect(result).toEqual([true]);
    });

    it('returns false when moderator tries to delete owner content', async () => {
      mockPrisma.community.findMany.mockResolvedValue([
        { id: 'comm-1', ownerId: 'owner-1' },
      ]);
      mockPrisma.communityMember.findMany
        .mockResolvedValueOnce([{ communityId: 'comm-1', role: 'MODERATOR' }])
        .mockResolvedValueOnce([]); // owner has no member row — ownerId check fires
      const result = await authorizer.canDeleteEach('mod-1', [
        { authorId: 'owner-1', communityId: 'comm-1' },
      ]);
      expect(result).toEqual([false]);
    });
  });

  // ── assertCanDelete ───────────────────────────────────────────────────────

  describe('assertCanDelete', () => {
    it('returns the authority when the actor is the author', async () => {
      const authority = await authorizer.assertCanDelete(
        { actorId: 'u', authorId: 'u', communityId: null },
        'post',
      );
      expect(authority).toBe('author');
    });

    it('throws ForbiddenException with "Not your post" for posts', async () => {
      mockPrisma.community.findUnique.mockResolvedValue(null);
      await expect(
        authorizer.assertCanDelete(
          { actorId: 'stranger', authorId: 'owner', communityId: 'comm-1' },
          'post',
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        authorizer.assertCanDelete(
          { actorId: 'stranger', authorId: 'owner', communityId: 'comm-1' },
          'post',
        ),
      ).rejects.toThrow('Not your post');
    });

    it('throws ForbiddenException with "Not your comment" for comments', async () => {
      mockPrisma.community.findUnique.mockResolvedValue(null);
      await expect(
        authorizer.assertCanDelete(
          { actorId: 'stranger', authorId: 'owner', communityId: 'comm-1' },
          'comment',
        ),
      ).rejects.toThrow('Not your comment');
    });
  });
});
