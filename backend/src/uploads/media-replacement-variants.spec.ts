import { MediaCleanupService } from './media-cleanup.service';

/**
 * Replacement cleanup has to reason about a *family* of files, not one key.
 *
 * Every folder behind the six replaceable media types also receives a
 * `<key>_thumb.webp` from the upload pipeline. Cleanup that only knew the
 * primary key got this wrong twice over, and both were visible in the live
 * bucket: the old thumbnail was left behind on every replacement (17 orphans),
 * and — worse — the historical sweep deleted the thumbnail that had just been
 * uploaded, because no entity column mentions a thumbnail key. Six of thirteen
 * live entity images had no thumbnail as a result.
 */
describe('media replacement — derived variants', () => {
  let prisma: any;
  let storage: any;
  let service: MediaCleanupService;
  let deleted: string[];

  const buildService = (
    opts: { referenced?: string[]; owned?: string[] } = {},
  ) => {
    deleted = [];
    const referenced = new Set(opts.referenced ?? []);
    prisma = {
      user: {
        findFirst: async ({ where }: any) => {
          const keys = (where.OR || []).map(
            (c: any) => c.avatar?.contains ?? c.cover?.contains,
          );
          return keys.some((k: string) => referenced.has(k))
            ? { id: 'u1' }
            : null;
        },
      },
      community: { findFirst: async () => null },
      conversation: { findFirst: async () => null },
      crewActivity: { findFirst: async () => null },
      campusEvent: { findFirst: async () => null },
      college: { findFirst: async () => null },
      media: {
        findFirst: async () => null,
        findMany: async () =>
          (opts.owned ?? []).map((objectKey) => ({ objectKey })),
        deleteMany: async () => ({ count: 1 }),
      },
    };
    storage = {
      delete: async (key: string) => {
        deleted.push(key);
        return true;
      },
    };
    service = new MediaCleanupService(prisma, storage);
    return service;
  };

  describe('variantKeysFor', () => {
    it('pairs an image with the thumbnail the pipeline generates', () => {
      buildService();
      expect(service.variantKeysFor('avatars/abc.webp')).toEqual([
        'avatars/abc.webp',
        'avatars/abc_thumb.webp',
      ]);
    });

    it('does not derive a thumbnail of a thumbnail', () => {
      buildService();
      expect(service.variantKeysFor('avatars/abc_thumb.webp')).toEqual([
        'avatars/abc_thumb.webp',
      ]);
    });

    it('leaves a key it cannot parse alone', () => {
      buildService();
      expect(service.variantKeysFor('weird-key-no-folder')).toEqual([
        'weird-key-no-folder',
      ]);
    });
  });

  describe('replacement', () => {
    it('deletes the old image and its thumbnail together', async () => {
      buildService();
      const result = await service.handleMediaReplacement(
        'USER_AVATAR',
        'u1',
        'avatars/old.webp',
        'avatars/new.webp',
        'u1',
      );
      expect(deleted).toEqual(
        expect.arrayContaining(['avatars/old.webp', 'avatars/old_thumb.webp']),
      );
      expect(result.deletedKeys).toContain('avatars/old_thumb.webp');
    });

    it('never deletes the incoming image or its thumbnail', async () => {
      // The sweep runs over media owned by the same user in the same folder.
      // The new thumbnail lives there and is named in no entity column, so
      // without the family expansion it was deleted moments after upload.
      buildService({
        referenced: ['avatars/new.webp'],
        owned: [
          'avatars/new.webp',
          'avatars/new_thumb.webp',
          'avatars/old.webp',
        ],
      });

      await service.handleMediaReplacement(
        'USER_AVATAR',
        'u1',
        'avatars/old.webp',
        'avatars/new.webp',
        'u1',
      );

      expect(deleted).not.toContain('avatars/new.webp');
      expect(deleted).not.toContain('avatars/new_thumb.webp');
      expect(deleted).toContain('avatars/old.webp');
    });

    it('deletes nothing when the same image is re-saved', async () => {
      buildService({ owned: ['avatars/same.webp', 'avatars/same_thumb.webp'] });
      const result = await service.handleMediaReplacement(
        'USER_AVATAR',
        'u1',
        'avatars/same.webp',
        'avatars/same.webp',
        'u1',
      );
      expect(deleted).toEqual([]);
      expect(result.skippedKeys[0].reason).toBe('Key unchanged');
    });

    it('deletes nothing on a first-time upload', async () => {
      buildService();
      const result = await service.handleMediaReplacement(
        'USER_AVATAR',
        'u1',
        null,
        'avatars/first.webp',
        'u1',
      );
      expect(deleted).toEqual([]);
      expect(result.success).toBe(true);
    });

    it('keeps the database update valid when storage deletion fails', async () => {
      buildService();
      storage.delete = async () => {
        throw new Error('R2 unavailable');
      };
      const result = await service.handleMediaReplacement(
        'USER_AVATAR',
        'u1',
        'avatars/old.webp',
        'avatars/new.webp',
        'u1',
      );
      // Reported, not thrown — the user's save already succeeded.
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('a thumbnail is alive when its base image is', () => {
    it('protects the thumbnail of a referenced image', async () => {
      buildService({ referenced: ['avatars/live.webp'] });
      await expect(
        service.isKeyReferencedInDb('avatars/live_thumb.webp'),
      ).resolves.toBe(true);
    });

    it('does not protect the thumbnail of an unreferenced image', async () => {
      buildService({ referenced: ['avatars/live.webp'] });
      await expect(
        service.isKeyReferencedInDb('avatars/dead_thumb.webp'),
      ).resolves.toBe(false);
    });

    it('is what stops a group-avatar sweep taking a profile picture', async () => {
      // Group avatars are uploaded into `avatars/`, the same folder as profile
      // pictures, so the GROUP_AVATAR sweep scans over them. The profile
      // picture is protected by its entity column; its thumbnail is protected
      // only by this rule.
      buildService({
        referenced: ['avatars/profile.webp'],
        owned: [
          'avatars/profile.webp',
          'avatars/profile_thumb.webp',
          'avatars/old-group.webp',
        ],
      });

      await service.handleMediaReplacement(
        'GROUP_AVATAR',
        'conv-1',
        'avatars/old-group.webp',
        'avatars/new-group.webp',
        'u1',
      );

      expect(deleted).not.toContain('avatars/profile.webp');
      expect(deleted).not.toContain('avatars/profile_thumb.webp');
      expect(deleted).toContain('avatars/old-group.webp');
    });
  });
});

/**
 * The guard every call site used to repeat inline. Seven copies of a three-part
 * condition is how one of them eventually drifts — and the two failure modes are
 * both destructive: miss the "was it submitted" check and editing a display name
 * deletes an avatar; miss the "did it change" check and re-saving the same image
 * deletes the image.
 */
describe('replaceEntityMedia — the shared guard', () => {
  let service: MediaCleanupService;
  let handled: any[];

  beforeEach(() => {
    service = new MediaCleanupService({} as any, {} as any);
    handled = [];
    jest
      .spyOn(service, 'handleMediaReplacement')
      .mockImplementation(async (...args: any[]) => {
        handled.push(args);
        return { success: true, deletedKeys: [], skippedKeys: [], errors: [] };
      });
  });

  const call = (over: any = {}) =>
    service.replaceEntityMedia({
      entityType: 'USER_AVATAR',
      entityId: 'u1',
      previous: 'avatars/old.webp',
      next: 'avatars/new.webp',
      ownerId: 'u1',
      ...over,
    });

  it('cleans up a genuine replacement', () => {
    call();
    expect(handled).toHaveLength(1);
    expect(handled[0].slice(0, 4)).toEqual([
      'USER_AVATAR',
      'u1',
      'avatars/old.webp',
      'avatars/new.webp',
    ]);
  });

  it('does nothing when the field was not part of the update', () => {
    // Editing a bio, a name, a location — anything that leaves media alone.
    call({ submitted: false });
    expect(handled).toHaveLength(0);
  });

  it('does nothing when there was no previous media', () => {
    call({ previous: null });
    expect(handled).toHaveLength(0);
  });

  it('does nothing when the same media is saved again', () => {
    call({ next: 'avatars/old.webp' });
    expect(handled).toHaveLength(0);
  });

  it('never throws out of a successful save', () => {
    (service.handleMediaReplacement as jest.Mock).mockRejectedValue(
      new Error('storage exploded'),
    );
    // It is called after the database update has already committed, so a
    // failure here must not surface as a failed save.
    expect(() => call()).not.toThrow();
  });
});

/**
 * Verification documents reference media by row id, not by storing a key in a
 * column, so every column-based check in `isKeyReferencedInDb` is blind to them.
 * No sweep reaches `verification/` today, but that is a property of the current
 * callers rather than of this method — and an identity document deleted out
 * from under a pending review is not a recoverable mistake.
 */
describe('verification documents are never collectable', () => {
  const build = (opts: { selfie?: boolean; idCard?: boolean }) => {
    const none = async () => null;
    const prisma: any = {
      user: { findFirst: none },
      community: { findFirst: none },
      conversation: { findFirst: none },
      crewActivity: { findFirst: none },
      campusEvent: { findFirst: none },
      college: { findFirst: none },
      media: {
        findFirst: async ({ where }: any) => {
          const wants = (where.OR || []).map((c: any) => Object.keys(c)[0]);
          if (opts.selfie && wants.includes('verificationSelfies'))
            return { id: 'm1' };
          if (opts.idCard && wants.includes('verificationIdCards'))
            return { id: 'm1' };
          return null;
        },
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
      },
    };
    return new MediaCleanupService(prisma, { delete: async () => true } as any);
  };

  it('protects a document attached as a selfie', async () => {
    await expect(
      build({ selfie: true }).isKeyReferencedInDb('verification/a.webp'),
    ).resolves.toBe(true);
  });

  it('protects a document attached as an ID card', async () => {
    await expect(
      build({ idCard: true }).isKeyReferencedInDb('verification/b.webp'),
    ).resolves.toBe(true);
  });

  it('still reports a genuinely unattached key as unreferenced', async () => {
    await expect(
      build({}).isKeyReferencedInDb('verification/orphan.webp'),
    ).resolves.toBe(false);
  });
});

/**
 * Externally-hosted avatars are stored as `Media` rows whose `objectKey` is a
 * full URL rather than a storage key, so that `avatarMediaId` has something to
 * point at. Three live accounts use a DiceBear avatar this way.
 *
 * Nothing must ever treat one of those as a deletable object: there is no
 * bucket key to delete, and the string would be parsed as `folder/name` by
 * anything splitting on `/`.
 */
describe('externally hosted media is never mistaken for a storage key', () => {
  const external = [
    'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka&backgroundColor=b6e3f4',
    'https://images.unsplash.com/photo-123',
    'https://media.giphy.com/media/abc/giphy.gif',
    'https://avatars.githubusercontent.com/u/1',
    'https://lh3.googleusercontent.com/a/x',
  ];

  it.each(external)('returns no storage key for %s', (url) => {
    const service = new MediaCleanupService({} as any, {} as any);
    expect(service.extractStorageKey(url)).toBeNull();
  });

  it('still resolves our own media URLs', () => {
    const service = new MediaCleanupService({} as any, {} as any);
    expect(service.extractStorageKey('/api/media/avatars/abc.webp')).toBe(
      'avatars/abc.webp',
    );
    expect(service.extractStorageKey('avatars/abc.webp')).toBe(
      'avatars/abc.webp',
    );
  });
});
