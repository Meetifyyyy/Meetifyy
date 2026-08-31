import {
  checkPresenceVisibility,
  resolvePresenceVisibilityForViewer,
  checkPresenceVisibilityBatch,
} from './privacy.helper';

/**
 * Minimal PrismaService double.
 * All methods are mocked via jest.fn() and reset between tests.
 */
function buildMockPrisma() {
  return {
    userSettings: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    follow: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

/**
 * Minimal BlocksService double.
 */
function buildMockBlocks() {
  return {
    isBlocked: jest.fn(),
    getExcludedUserIds: jest.fn(),
    filterBlockedUsers: jest.fn(),
  };
}

// ─── checkPresenceVisibility ──────────────────────────────────────────────────

describe('checkPresenceVisibility', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let blocks: ReturnType<typeof buildMockBlocks>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    blocks = buildMockBlocks();
    jest.clearAllMocks();
  });

  it('returns false when isEnabled is false', async () => {
    const result = await checkPresenceVisibility(
      'target',
      'viewer',
      'everyone',
      false,
      prisma as any,
      blocks as any,
    );
    expect(result).toBe(false);
  });

  it('returns false when targetUserId is empty', async () => {
    const result = await checkPresenceVisibility(
      '',
      'viewer',
      'everyone',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toBe(false);
  });

  it('returns true when viewer is looking at themselves', async () => {
    const result = await checkPresenceVisibility(
      'user-1',
      'user-1',
      'everyone',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toBe(true);
    expect(blocks.isBlocked).not.toHaveBeenCalled();
  });

  it('returns false when viewer has blocked the target (or vice-versa)', async () => {
    blocks.isBlocked.mockResolvedValue(true);
    const result = await checkPresenceVisibility(
      'target',
      'viewer',
      'everyone',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toBe(false);
  });

  it('returns false when viewer has hidden their own online status', async () => {
    blocks.isBlocked.mockResolvedValue(false);
    prisma.userSettings.findUnique.mockResolvedValue({
      showOnlineStatus: false,
    });

    const result = await checkPresenceVisibility(
      'target',
      'viewer',
      'everyone',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toBe(false);
  });

  it('returns false for rule "nobody"', async () => {
    blocks.isBlocked.mockResolvedValue(false);
    prisma.userSettings.findUnique.mockResolvedValue({
      showOnlineStatus: true,
    });

    const result = await checkPresenceVisibility(
      'target',
      'viewer',
      'nobody',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toBe(false);
  });

  it('returns true for rule "everyone" (no block, no hidden status)', async () => {
    blocks.isBlocked.mockResolvedValue(false);
    prisma.userSettings.findUnique.mockResolvedValue({
      showOnlineStatus: true,
    });

    const result = await checkPresenceVisibility(
      'target',
      'viewer',
      'everyone',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toBe(true);
  });

  describe('rule: "following" (target must follow viewer)', () => {
    beforeEach(() => {
      blocks.isBlocked.mockResolvedValue(false);
      prisma.userSettings.findUnique.mockResolvedValue({
        showOnlineStatus: true,
      });
    });

    it('returns true when the target follows the viewer', async () => {
      prisma.follow.findUnique.mockResolvedValue({
        followerId: 'target',
        followingId: 'viewer',
      });
      const result = await checkPresenceVisibility(
        'target',
        'viewer',
        'following',
        true,
        prisma as any,
        blocks as any,
      );
      expect(result).toBe(true);
    });

    it('returns false when the target does NOT follow the viewer', async () => {
      prisma.follow.findUnique.mockResolvedValue(null);
      const result = await checkPresenceVisibility(
        'target',
        'viewer',
        'following',
        true,
        prisma as any,
        blocks as any,
      );
      expect(result).toBe(false);
    });
  });

  describe('rule: "mutual" (both must follow each other)', () => {
    beforeEach(() => {
      blocks.isBlocked.mockResolvedValue(false);
      prisma.userSettings.findUnique.mockResolvedValue({
        showOnlineStatus: true,
      });
    });

    it('returns true when both follow each other', async () => {
      prisma.follow.findUnique
        .mockResolvedValueOnce({ followerId: 'target', followingId: 'viewer' }) // target → viewer
        .mockResolvedValueOnce({ followerId: 'viewer', followingId: 'target' }); // viewer → target
      const result = await checkPresenceVisibility(
        'target',
        'viewer',
        'mutual',
        true,
        prisma as any,
        blocks as any,
      );
      expect(result).toBe(true);
    });

    it('returns false when only target follows viewer (not mutual)', async () => {
      prisma.follow.findUnique
        .mockResolvedValueOnce({ followerId: 'target', followingId: 'viewer' })
        .mockResolvedValueOnce(null); // viewer does NOT follow target
      const result = await checkPresenceVisibility(
        'target',
        'viewer',
        'mutual',
        true,
        prisma as any,
        blocks as any,
      );
      expect(result).toBe(false);
    });

    it('returns false when only viewer follows target (not mutual)', async () => {
      prisma.follow.findUnique
        .mockResolvedValueOnce(null) // target does NOT follow viewer
        .mockResolvedValueOnce({ followerId: 'viewer', followingId: 'target' });
      const result = await checkPresenceVisibility(
        'target',
        'viewer',
        'mutual',
        true,
        prisma as any,
        blocks as any,
      );
      expect(result).toBe(false);
    });
  });
});

// ─── resolvePresenceVisibilityForViewer ───────────────────────────────────────

describe('resolvePresenceVisibilityForViewer', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let blocks: ReturnType<typeof buildMockBlocks>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    blocks = buildMockBlocks();
    jest.clearAllMocks();
    // Default: viewer shows status, no blocks
    blocks.getExcludedUserIds.mockResolvedValue([]);
    prisma.userSettings.findUnique.mockResolvedValue({
      showOnlineStatus: true,
    });
    prisma.follow.findMany.mockResolvedValue([]);
  });

  it('returns an empty set for an empty targets array', async () => {
    const result = await resolvePresenceVisibilityForViewer(
      'viewer',
      [],
      prisma as any,
      blocks as any,
    );
    expect(result.size).toBe(0);
  });

  it('returns an empty set when viewerUserId is empty', async () => {
    const result = await resolvePresenceVisibilityForViewer(
      '',
      [{ userId: 'u1', rule: 'everyone', isEnabled: true }],
      prisma as any,
      blocks as any,
    );
    expect(result.size).toBe(0);
  });

  it('filters out blocked targets completely', async () => {
    blocks.getExcludedUserIds.mockResolvedValue(['blocked-user']);
    const result = await resolvePresenceVisibilityForViewer(
      'viewer',
      [
        { userId: 'blocked-user', rule: 'everyone', isEnabled: true },
        { userId: 'normal-user', rule: 'everyone', isEnabled: true },
      ],
      prisma as any,
      blocks as any,
    );
    expect(result.has('blocked-user')).toBe(false);
    expect(result.has('normal-user')).toBe(true);
  });

  it('returns empty set when viewer has hidden their own online status', async () => {
    prisma.userSettings.findUnique.mockResolvedValue({
      showOnlineStatus: false,
    });
    const result = await resolvePresenceVisibilityForViewer(
      'viewer',
      [{ userId: 'u1', rule: 'everyone', isEnabled: true }],
      prisma as any,
      blocks as any,
    );
    expect(result.size).toBe(0);
  });

  it('excludes targets whose isEnabled is false', async () => {
    const result = await resolvePresenceVisibilityForViewer(
      'viewer',
      [{ userId: 'u1', rule: 'everyone', isEnabled: false }],
      prisma as any,
      blocks as any,
    );
    expect(result.has('u1')).toBe(false);
  });

  it('adds "everyone" targets directly to the visible set', async () => {
    const result = await resolvePresenceVisibilityForViewer(
      'viewer',
      [{ userId: 'u1', rule: 'everyone', isEnabled: true }],
      prisma as any,
      blocks as any,
    );
    expect(result.has('u1')).toBe(true);
  });

  it('adds the viewer themselves regardless of rule', async () => {
    const result = await resolvePresenceVisibilityForViewer(
      'viewer',
      [{ userId: 'viewer', rule: 'nobody', isEnabled: true }],
      prisma as any,
      blocks as any,
    );
    expect(result.has('viewer')).toBe(true);
  });

  it('excludes "nobody" targets', async () => {
    const result = await resolvePresenceVisibilityForViewer(
      'viewer',
      [{ userId: 'u1', rule: 'nobody', isEnabled: true }],
      prisma as any,
      blocks as any,
    );
    expect(result.has('u1')).toBe(false);
  });

  it('resolves "following" rule — includes only targets that follow the viewer', async () => {
    prisma.follow.findMany.mockResolvedValue([{ followerId: 'u1' }]);
    const result = await resolvePresenceVisibilityForViewer(
      'viewer',
      [
        { userId: 'u1', rule: 'following', isEnabled: true },
        { userId: 'u2', rule: 'following', isEnabled: true },
      ],
      prisma as any,
      blocks as any,
    );
    expect(result.has('u1')).toBe(true);
    expect(result.has('u2')).toBe(false);
  });

  it('resolves "mutual" rule — includes only mutual followers', async () => {
    // u1 follows viewer AND viewer follows u1 → mutual
    // u2 follows viewer but viewer doesn't follow u2 → not mutual
    prisma.follow.findMany
      .mockResolvedValueOnce([{ followerId: 'u1' }, { followerId: 'u2' }]) // target→viewer
      .mockResolvedValueOnce([{ followingId: 'u1' }]); // viewer→target (only u1)

    const result = await resolvePresenceVisibilityForViewer(
      'viewer',
      [
        { userId: 'u1', rule: 'mutual', isEnabled: true },
        { userId: 'u2', rule: 'mutual', isEnabled: true },
      ],
      prisma as any,
      blocks as any,
    );
    expect(result.has('u1')).toBe(true);
    expect(result.has('u2')).toBe(false);
  });
});

// ─── checkPresenceVisibilityBatch ─────────────────────────────────────────────

describe('checkPresenceVisibilityBatch', () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let blocks: ReturnType<typeof buildMockBlocks>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    blocks = buildMockBlocks();
    jest.clearAllMocks();
    blocks.filterBlockedUsers.mockImplementation((_: string, ids: string[]) =>
      Promise.resolve(ids),
    );
    prisma.userSettings.findMany.mockResolvedValue([]);
    prisma.follow.findMany.mockResolvedValue([]);
  });

  it('returns [] when isEnabled is false', async () => {
    const result = await checkPresenceVisibilityBatch(
      'target',
      ['v1', 'v2'],
      'everyone',
      false,
      prisma as any,
      blocks as any,
    );
    expect(result).toEqual([]);
  });

  it('returns [] when targetUserId is empty', async () => {
    const result = await checkPresenceVisibilityBatch(
      '',
      ['v1'],
      'everyone',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toEqual([]);
  });

  it('returns [] for rule "nobody"', async () => {
    const result = await checkPresenceVisibilityBatch(
      'target',
      ['v1', 'v2'],
      'nobody',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toEqual([]);
  });

  it('returns all eligible viewers for rule "everyone"', async () => {
    const result = await checkPresenceVisibilityBatch(
      'target',
      ['v1', 'v2'],
      'everyone',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toEqual(expect.arrayContaining(['v1', 'v2']));
  });

  it('excludes viewers who have hidden their own online status', async () => {
    prisma.userSettings.findMany.mockResolvedValue([
      { userId: 'v2', showOnlineStatus: false },
    ]);
    const result = await checkPresenceVisibilityBatch(
      'target',
      ['v1', 'v2'],
      'everyone',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toContain('v1');
    expect(result).not.toContain('v2');
  });

  it('calls filterBlockedUsers to remove blocked viewers', async () => {
    blocks.filterBlockedUsers.mockResolvedValue(['v1']); // v2 is blocked
    const result = await checkPresenceVisibilityBatch(
      'target',
      ['v1', 'v2'],
      'everyone',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toContain('v1');
    expect(result).not.toContain('v2');
  });

  it('filters "following" viewers to those the target actually follows', async () => {
    prisma.follow.findMany.mockResolvedValue([{ followingId: 'v1' }]);
    const result = await checkPresenceVisibilityBatch(
      'target',
      ['v1', 'v2'],
      'following',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toContain('v1');
    expect(result).not.toContain('v2');
  });

  it('filters "mutual" viewers correctly', async () => {
    // target follows v1 (only), viewer v1 also follows target → mutual for v1
    prisma.follow.findMany
      .mockResolvedValueOnce([{ followingId: 'v1' }]) // target→viewers
      .mockResolvedValueOnce([{ followerId: 'v1' }]); // viewers→target

    const result = await checkPresenceVisibilityBatch(
      'target',
      ['v1', 'v2'],
      'mutual',
      true,
      prisma as any,
      blocks as any,
    );
    expect(result).toContain('v1');
    expect(result).not.toContain('v2');
  });
});
