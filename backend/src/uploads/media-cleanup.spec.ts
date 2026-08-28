import { MediaCleanupService } from './media-cleanup.service';

describe('MediaCleanupService', () => {
  let service: MediaCleanupService;
  let mockPrisma: any;
  let mockStorageProvider: any;

  beforeEach(() => {
    mockStorageProvider = {
      delete: jest.fn().mockResolvedValue(true),
      list: jest.fn().mockResolvedValue([]),
    };

    mockPrisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      community: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      crewActivity: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      campusEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      college: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      media: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    service = new MediaCleanupService(mockPrisma as any, mockStorageProvider as any);
  });

  describe('extractStorageKey', () => {
    it('should extract canonical storage keys from various formats', () => {
      expect(service.extractStorageKey('avatars/user-123.webp')).toBe('avatars/user-123.webp');
      expect(service.extractStorageKey('/api/media/profile-covers/cover-123.webp')).toBe(
        'profile-covers/cover-123.webp',
      );
      expect(
        service.extractStorageKey(
          'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/community-covers/cc.webp?v=1#tag',
        ),
      ).toBe('community-covers/cc.webp');
      expect(
        service.extractStorageKey(
          'https://test.supabase.co/storage/v1/object/public/meetifyy-dev/avatars/old.png',
        ),
      ).toBe('avatars/old.png');
      expect(
        service.extractStorageKey('https://meetifyy.app/api/media/activities/act-cover.jpg'),
      ).toBe('activities/act-cover.jpg');
      expect(
        service.extractStorageKey('http://localhost:3000/api/media/events/poster-1.webp?t=999'),
      ).toBe('events/poster-1.webp');
    });

    it('should return null for external, blob, data, and falsy strings', () => {
      expect(service.extractStorageKey(null)).toBeNull();
      expect(service.extractStorageKey(undefined)).toBeNull();
      expect(service.extractStorageKey('')).toBeNull();
      expect(service.extractStorageKey('   ')).toBeNull();
      expect(service.extractStorageKey('blob:http://localhost:3000/123')).toBeNull();
      expect(service.extractStorageKey('data:image/webp;base64,AAAA')).toBeNull();
      expect(service.extractStorageKey('https://images.unsplash.com/photo-123')).toBeNull();
      expect(service.extractStorageKey('https://media.giphy.com/media/xyz/giphy.gif')).toBeNull();
      expect(service.extractStorageKey('https://avatars.githubusercontent.com/u/123')).toBeNull();
    });
  });

  describe('isProtectedKey', () => {
    it('should identify default, preset, system, and support assets as protected', () => {
      expect(service.isProtectedKey('defaults/avatar-1.webp')).toBe(true);
      expect(service.isProtectedKey('v2-defaults/cover.webp')).toBe(true);
      expect(service.isProtectedKey('presets/images/preset-image-party-1.webp')).toBe(true);
      expect(service.isProtectedKey('presets/posters/preset-gif-coding-2.webp')).toBe(true);
      expect(service.isProtectedKey('system/logo.webp')).toBe(true);
      expect(service.isProtectedKey('assets/banner.webp')).toBe(true);
      expect(service.isProtectedKey('support/ticket-attachment.pdf')).toBe(true);
      expect(service.isProtectedKey('mock-user-avatar.png')).toBe(true);
    });

    it('should not protect normal user-uploaded assets', () => {
      expect(service.isProtectedKey('avatars/user-abc-123.webp')).toBe(false);
      expect(service.isProtectedKey('profile-covers/cov-999.webp')).toBe(false);
      expect(service.isProtectedKey('community-icons/comm-11.webp')).toBe(false);
      expect(service.isProtectedKey('community-covers/cc-99.webp')).toBe(false);
      expect(service.isProtectedKey('groups/grp-77.webp')).toBe(false);
      expect(service.isProtectedKey('activities/act-88.webp')).toBe(false);
      expect(service.isProtectedKey('events/poster-55.webp')).toBe(false);
      expect(service.isProtectedKey('colleges/logo-44.webp')).toBe(false);
    });
  });

  describe('handleMediaReplacement', () => {
    it('Scenario 1: should successfully delete replaced media from R2 and clean up Media table (safe order)', async () => {
      const oldAvatar = 'avatars/old-avatar-123.webp';
      const newAvatar = 'avatars/new-avatar-456.webp';

      const res = await service.handleMediaReplacement(
        'USER_AVATAR',
        'user-1',
        oldAvatar,
        newAvatar,
        'user-1',
      );

      expect(res.success).toBe(true);
      expect(res.deletedKeys).toContain(oldAvatar);
      expect(mockStorageProvider.delete).toHaveBeenCalledWith(oldAvatar);
      expect(mockPrisma.media.deleteMany).toHaveBeenCalledWith({
        where: { objectKey: oldAvatar },
      });
    });

    it('Scenario 2: should handle replacement when no previous media existed (first upload)', async () => {
      const newAvatar = 'avatars/new-avatar-456.webp';

      const res = await service.handleMediaReplacement(
        'USER_AVATAR',
        'user-1',
        null,
        newAvatar,
        'user-1',
      );

      expect(res.success).toBe(true);
      expect(res.deletedKeys).toHaveLength(0);
      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
    });

    it('Scenario 3: should NOT delete old media if it is a protected preset or default asset', async () => {
      const oldAvatar = 'defaults/v2-profile-avatar.webp';
      const newAvatar = 'avatars/custom-avatar-123.webp';

      const res = await service.handleMediaReplacement(
        'USER_AVATAR',
        'user-1',
        oldAvatar,
        newAvatar,
        'user-1',
      );

      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
      expect(res.skippedKeys[0].reason).toContain('Protected');
    });

    it('Scenario 4: should NOT delete old media if it did not change', async () => {
      const avatar = 'avatars/same-avatar.webp';

      const res = await service.handleMediaReplacement(
        'USER_AVATAR',
        'user-1',
        avatar,
        avatar,
        'user-1',
      );

      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
      expect(res.skippedKeys[0].reason).toContain('unchanged');
    });

    it('Scenario 5: should NOT delete old media if it is still referenced by another record in DB', async () => {
      const oldAvatar = 'avatars/shared-avatar.webp';
      const newAvatar = 'avatars/new-avatar.webp';

      // Mock that another user references the same avatar
      mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-2' });

      const res = await service.handleMediaReplacement(
        'USER_AVATAR',
        'user-1',
        oldAvatar,
        newAvatar,
        'user-1',
      );

      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
      expect(res.skippedKeys[0].reason).toContain('actively referenced');
    });

    it('Scenario 6 (Edge Case): User uses same image for avatar AND cover; replacing avatar MUST NOT delete cover', async () => {
      const sharedUserImage = 'avatars/dual-use-image.webp';
      const newAvatar = 'avatars/new-unique-avatar.webp';

      // Simulate that user-1 is still using dual-use-image as their cover!
      mockPrisma.user.findFirst.mockImplementation(async ({ where }: any) => {
        // where has OR: [{ avatar: { contains: ... }, id: { not: 'user-1' } }, { cover: { contains: ... } }]
        // Since cover is checked for all users, it should match user-1's cover
        if (where.OR?.some((cond: any) => cond.cover?.contains === sharedUserImage)) {
          return { id: 'user-1' };
        }
        return null;
      });

      const res = await service.handleMediaReplacement(
        'USER_AVATAR',
        'user-1',
        sharedUserImage,
        newAvatar,
        'user-1',
      );

      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
      expect(res.skippedKeys[0].reason).toContain('actively referenced');
    });

    it('Scenario 7 (Edge Case): Community uses same image for avatar and cover; replacing avatar MUST NOT delete cover', async () => {
      const sharedCommImage = 'community-icons/dual-comm.webp';
      const newCommAvatar = 'community-icons/new-comm-avatar.webp';

      mockPrisma.community.findFirst.mockImplementation(async ({ where }: any) => {
        if (where.OR?.some((cond: any) => cond.coverKey?.contains === sharedCommImage)) {
          return { id: 'comm-1' };
        }
        return null;
      });

      const res = await service.handleMediaReplacement(
        'COMMUNITY_AVATAR',
        'comm-1',
        sharedCommImage,
        newCommAvatar,
        'user-1',
      );

      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
      expect(res.skippedKeys[0].reason).toContain('actively referenced');
    });

    it('Scenario 8: should handle storage deletion failure safely without throwing', async () => {
      const oldAvatar = 'avatars/old-avatar.webp';
      const newAvatar = 'avatars/new-avatar.webp';

      mockStorageProvider.delete.mockRejectedValueOnce(new Error('R2 Network Timeout'));

      const res = await service.handleMediaReplacement(
        'USER_AVATAR',
        'user-1',
        oldAvatar,
        newAvatar,
        'user-1',
      );

      expect(res.success).toBe(false);
      expect(res.errors[0].error).toContain('R2 Network Timeout');
    });

    it('Scenario 9: Media removal without replacement (clearing avatar)', async () => {
      const oldAvatar = 'avatars/old-avatar-to-remove.webp';

      const res = await service.handleMediaReplacement(
        'USER_AVATAR',
        'user-1',
        oldAvatar,
        null,
        'user-1',
      );

      expect(res.success).toBe(true);
      expect(res.deletedKeys).toContain(oldAvatar);
      expect(mockStorageProvider.delete).toHaveBeenCalledWith(oldAvatar);
    });

    it('Scenario 10: All entity types supported (CampusEvent, Group, Activity, College)', async () => {
      // CampusEvent poster
      await service.handleMediaReplacement(
        'CAMPUS_EVENT_POSTER',
        'event-1',
        'events/old-poster.webp',
        'events/new-poster.webp',
        'user-1',
      );
      expect(mockStorageProvider.delete).toHaveBeenCalledWith('events/old-poster.webp');

      // Group avatar
      await service.handleMediaReplacement(
        'GROUP_AVATAR',
        'conv-1',
        'groups/old-grp.webp',
        'groups/new-grp.webp',
        'user-1',
      );
      expect(mockStorageProvider.delete).toHaveBeenCalledWith('groups/old-grp.webp');

      // Activity cover
      await service.handleMediaReplacement(
        'ACTIVITY_COVER',
        'act-1',
        'activities/old-act.webp',
        'activities/new-act.webp',
        'user-1',
      );
      expect(mockStorageProvider.delete).toHaveBeenCalledWith('activities/old-act.webp');

      // College logo
      await service.handleMediaReplacement(
        'COLLEGE_LOGO',
        'coll-1',
        'colleges/old-logo.webp',
        'colleges/new-logo.webp',
      );
      expect(mockStorageProvider.delete).toHaveBeenCalledWith('colleges/old-logo.webp');
    });
  });

  describe('cleanupEntityMediaHistory', () => {
    it('should find and clean up historical unreferenced candidate files', async () => {
      mockPrisma.media.findMany.mockResolvedValueOnce([
        { objectKey: 'avatars/orphan-1.webp' },
        { objectKey: 'avatars/active-current.webp' },
        { objectKey: 'defaults/v2-avatar.webp' },
      ]);

      const res = await service.cleanupEntityMediaHistory(
        'USER_AVATAR',
        'user-1',
        ['avatars/active-current.webp'],
        'user-1',
      );

      expect(res.deletedKeys).toContain('avatars/orphan-1.webp');
      expect(res.skippedKeys.some((s) => s.key === 'avatars/active-current.webp')).toBe(true);
      expect(res.skippedKeys.some((s) => s.key === 'defaults/v2-avatar.webp')).toBe(true);
      expect(mockStorageProvider.delete).toHaveBeenCalledWith('avatars/orphan-1.webp');
      expect(mockPrisma.media.deleteMany).toHaveBeenCalledWith({
        where: { objectKey: 'avatars/orphan-1.webp' },
      });
    });

    it('should be safe and idempotent when re-run multiple times', async () => {
      mockPrisma.media.findMany.mockResolvedValue([]);

      const res = await service.cleanupEntityMediaHistory(
        'USER_AVATAR',
        'user-1',
        ['avatars/active.webp'],
        'user-1',
      );

      expect(res.success).toBe(true);
      expect(res.deletedKeys).toHaveLength(0);
      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
    });
  });

  describe('discardFailedNewUpload', () => {
    it('should discard newly uploaded file when database update fails', async () => {
      const failedUploadKey = 'avatars/failed-upload-999.webp';

      const discarded = await service.discardFailedNewUpload(failedUploadKey, 'user-1');

      expect(discarded).toBe(true);
      expect(mockStorageProvider.delete).toHaveBeenCalledWith(failedUploadKey);
      expect(mockPrisma.media.deleteMany).toHaveBeenCalledWith({
        where: { objectKey: failedUploadKey, ownerId: 'user-1', postId: null },
      });
    });

    it('should never discard protected assets', async () => {
      const protectedKey = 'defaults/v2-profile-avatar.webp';

      const discarded = await service.discardFailedNewUpload(protectedKey, 'user-1');

      expect(discarded).toBe(false);
      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
    });
  });

  describe('deletePermanently', () => {
    it('should delete storage object and Media row', async () => {
      const outcome = await service.deletePermanently('profile-covers/cover-1.webp');

      expect(outcome.success).toBe(true);
      expect(outcome.key).toBe('profile-covers/cover-1.webp');
      expect(mockStorageProvider.delete).toHaveBeenCalledWith('profile-covers/cover-1.webp');
      expect(mockPrisma.media.deleteMany).toHaveBeenCalledWith({
        where: { objectKey: 'profile-covers/cover-1.webp' },
      });
    });

    it('should refuse to delete protected assets', async () => {
      const outcome = await service.deletePermanently('presets/party.webp');

      expect(outcome.success).toBe(false);
      expect(outcome.skipped).toBe(true);
      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
    });
  });
});
