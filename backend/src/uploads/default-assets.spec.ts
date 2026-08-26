import { DefaultAssetsService } from './default-assets.service';

/**
 * The backfill's matching predicate.
 *
 * This shipped once as `{ in: [null, ''] }`, which reads as "either null or
 * empty" and matches neither: Prisma compiles it to `IN (NULL, '')`, and in
 * SQL's three-valued logic `x = NULL` is never true. Every row with a NULL
 * cover was skipped, so the backfill reported nothing and silently updated
 * nothing — the failure mode of a query that is wrong rather than broken.
 *
 * These tests assert the *shape* of the filter, because that shape is the
 * whole bug: a filter that looks right and quietly matches zero rows.
 */
describe('default asset backfill', () => {
  const buildService = () => {
    const communities: any[] = [];
    const users: any[] = [];
    const prisma = {
      community: {
        updateMany: jest.fn(async (args: any) => {
          communities.push(args);
          return { count: 1 };
        }),
      },
      user: {
        updateMany: jest.fn(async (args: any) => {
          users.push(args);
          return { count: 1 };
        }),
      },
      media: { upsert: jest.fn() },
    };
    const service = new DefaultAssetsService(
      {} as any,
      prisma as any,
      { get: () => undefined } as any,
    );
    // Pretend the four assets published successfully.
    for (const n of [
      'community-cover',
      'profile-cover',
      'community-avatar',
      'profile-avatar',
    ]) {
      (service as any).keys.set(n, `defaults/${n}-v1.webp`);
    }
    return { service, prisma, communities, users };
  };

  const run = async () => {
    const ctx = buildService();
    await (ctx.service as any).backfillExisting();
    return ctx;
  };

  it('matches a NULL column with an explicit OR, never an IN list', async () => {
    const { communities } = await run();
    const coverCall = communities.find((c) => 'coverKey' in c.data);

    expect(coverCall.where).toEqual({
      OR: [{ coverKey: null }, { coverKey: '' }],
    });
    // The shape that silently matched nothing.
    expect(JSON.stringify(coverCall.where)).not.toContain('"in"');
  });

  it('treats an empty string as missing too', async () => {
    // Older code wrote '' rather than NULL; both mean "no image chosen".
    const { users } = await run();
    const coverCall = users.find((c) => 'cover' in c.data);
    expect(coverCall.where.OR).toContainEqual({ cover: '' });
  });

  it('fills all four fields', async () => {
    const { communities, users } = await run();
    expect(communities.map((c) => Object.keys(c.data)[0]).sort()).toEqual([
      'avatarKey',
      'coverKey',
    ]);
    expect(users.map((c) => Object.keys(c.data)[0]).sort()).toEqual([
      'avatar',
      'cover',
    ]);
  });

  it('writes an /api/media/ reference, the same shape an upload gets', async () => {
    // Anything else and downstream code could tell a default from a real
    // upload — which is the one thing this feature must not allow.
    const { communities } = await run();
    for (const call of communities) {
      expect(Object.values(call.data)[0]).toMatch(
        /^\/api\/media\/defaults\/.+\.webp$/,
      );
    }
  });

  it('touches nothing when the assets failed to publish', async () => {
    const { service, prisma } = buildService();
    (service as any).keys.clear();
    await (service as any).backfillExisting();

    // A bucket outage must not blank out anyone's images.
    expect(prisma.community.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * Moving existing records onto a new version of the artwork.
 *
 * The risk here is not the update failing — it is the update matching too
 * much. These rows hold real people's profile pictures, so the predicate has
 * to be provably incapable of touching anything a person chose, and that is
 * what most of these tests assert.
 */
describe('repointing records onto the current defaults', () => {
  const buildService = (version = 'v2') => {
    const calls: Array<{ model: string; args: any }> = [];
    const prisma = {
      community: {
        updateMany: jest.fn(async (args: any) => {
          calls.push({ model: 'community', args });
          return { count: 2 };
        }),
      },
      user: {
        updateMany: jest.fn(async (args: any) => {
          calls.push({ model: 'user', args });
          return { count: 3 };
        }),
      },
      media: { upsert: jest.fn() },
    };
    const service = new DefaultAssetsService(
      {} as any,
      prisma as any,
      { get: () => undefined } as any,
    );
    for (const n of [
      'community-cover',
      'profile-cover',
      'community-avatar',
      'profile-avatar',
    ]) {
      (service as any).keys.set(n, `defaults/${n}-${version}.webp`);
    }
    return { service, prisma, calls };
  };

  const run = async () => {
    const ctx = buildService();
    await (ctx.service as any).repointOutdatedDefaults();
    /** The update issued for one column, or a failure naming what is missing. */
    const callFor = (
      model: string,
      field: string,
    ): { where: any; data: any } => {
      const hit = ctx.calls.find(
        (c) => c.model === model && field in c.args.data,
      );
      if (!hit) throw new Error(`no ${model}.${field} update was issued`);
      return hit.args;
    };
    return { ...ctx, callFor };
  };

  /** Does a stored value satisfy the filter the service built? */
  const matches = (where: any, field: string, value: string | null) => {
    const [prefixClause, notClause] = where.AND;
    const prefix = prefixClause[field].startsWith;
    const current = notClause.NOT[field];
    return (
      typeof value === 'string' && value.startsWith(prefix) && value !== current
    );
  };

  it('moves user covers and community covers onto the current version', async () => {
    const { callFor } = await run();

    expect(callFor('user', 'cover').data.cover).toBe(
      '/api/media/defaults/profile-cover-v2.webp',
    );
    expect(callFor('community', 'coverKey').data.coverKey).toBe(
      '/api/media/defaults/community-cover-v2.webp',
    );
  });

  it('selects exactly the rows still on an older default', async () => {
    const { callFor } = await run();
    const { where } = callFor('user', 'cover');

    expect(
      matches(where, 'cover', '/api/media/defaults/profile-cover-v1.webp'),
    ).toBe(true);
    // Already current — updating it again would be pure write amplification.
    expect(
      matches(where, 'cover', '/api/media/defaults/profile-cover-v2.webp'),
    ).toBe(false);
  });

  it('cannot match a picture the user actually chose', async () => {
    // The whole safety argument: uploads never live under `defaults/`, so no
    // chosen image can satisfy the prefix, however it was stored.
    const { callFor } = await run();
    const { where } = callFor('user', 'cover');

    for (const chosen of [
      '/api/media/covers/dfcb6659-8590-4643-93ad-d79f0e429c1b.webp',
      '/api/media/avatars/a307fc54.webp',
      'https://cdn.example.com/defaults/profile-cover-v1.webp',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      '',
      null,
    ]) {
      expect(matches(where, 'cover', chosen)).toBe(false);
    }
  });

  it('does not let one asset claim another asset rows', async () => {
    // `profile-cover-` and `profile-avatar-` must not overlap, or a bump would
    // shuffle avatars into covers.
    const { callFor } = await run();
    const cover = callFor('user', 'cover').where;
    const avatar = callFor('user', 'avatar').where;

    expect(
      matches(cover, 'cover', '/api/media/defaults/profile-avatar-v1.webp'),
    ).toBe(false);
    expect(
      matches(avatar, 'avatar', '/api/media/defaults/profile-cover-v1.webp'),
    ).toBe(false);
  });

  it('is idempotent: a second run has nothing left to match', async () => {
    const { calls } = await run();
    for (const { args } of calls) {
      const field = Object.keys(args.data)[0];
      // Every row the first run wrote now holds precisely the value the
      // filter excludes.
      expect(matches(args.where, field, args.data[field])).toBe(false);
    }
  });

  it('touches nothing when the assets failed to publish', async () => {
    // A bucket outage would otherwise repoint live rows at a key that is not
    // there — trading stale artwork for broken images.
    const { service, prisma } = buildService();
    (service as any).keys.clear();
    await (service as any).repointOutdatedDefaults();

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.community.updateMany).not.toHaveBeenCalled();
  });
});
