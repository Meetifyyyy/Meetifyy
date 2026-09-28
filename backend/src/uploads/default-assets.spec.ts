import {
  DefaultAssetsService,
  type DefaultAssetName,
} from './default-assets.service';
import { stub } from '../common/testing/stub';
import type { StorageProvider } from './providers/storage-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';

/** The arguments of a recorded updateMany. */
type UpdateArgs = {
  where: Record<string, unknown>;
  data: Record<string, string>;
};

/** The published defaults. The retired cover assets are no longer names. */
const ASSET_NAMES: DefaultAssetName[] = ['community-avatar', 'profile-avatar'];

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
    const communities: UpdateArgs[] = [];
    const users: UpdateArgs[] = [];
    const prisma = {
      community: {
        updateMany: jest.fn((args: UpdateArgs) => {
          communities.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
      user: {
        updateMany: jest.fn((args: UpdateArgs) => {
          users.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
      media: { upsert: jest.fn() },
    };
    const service = new DefaultAssetsService(
      stub<StorageProvider>(),
      stub<PrismaService>(prisma),
      stub<ConfigService>({ get: () => undefined }),
    );
    // Pretend the assets published successfully.
    for (const n of ASSET_NAMES) {
      service['keys'].set(n, `defaults/${n}-v1.webp`);
    }
    return { service, prisma, communities, users };
  };

  const run = async () => {
    const ctx = buildService();
    await ctx.service['backfillExisting']();
    return ctx;
  };

  it('matches a NULL column with an explicit OR, never an IN list', async () => {
    const { communities } = await run();
    const avatarCall = communities.find((c) => 'avatarKey' in c.data);

    expect(avatarCall!.where).toEqual({
      OR: [{ avatarKey: null }, { avatarKey: '' }],
    });
    // The shape that silently matched nothing.
    expect(JSON.stringify(avatarCall!.where)).not.toContain('"in"');
  });

  it('treats an empty string as missing too', async () => {
    // Older code wrote '' rather than NULL; both mean "no image chosen".
    const { users } = await run();
    const avatarCall = users.find((c) => 'avatar' in c.data);
    expect(avatarCall!.where.OR).toContainEqual({ avatar: '' });
  });

  it('fills avatar fields', async () => {
    const { communities, users } = await run();
    expect(communities.map((c) => Object.keys(c.data)[0]).sort()).toEqual([
      'avatarKey',
    ]);
    expect(users.map((c) => Object.keys(c.data)[0]).sort()).toEqual(['avatar']);
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
    service['keys'].clear();
    await service['backfillExisting']();

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
    const calls: Array<{ model: string; args: UpdateArgs }> = [];
    const prisma = {
      community: {
        updateMany: jest.fn((args: UpdateArgs) => {
          calls.push({ model: 'community', args });
          return Promise.resolve({ count: 2 });
        }),
      },
      user: {
        updateMany: jest.fn((args: UpdateArgs) => {
          calls.push({ model: 'user', args });
          return Promise.resolve({ count: 3 });
        }),
      },
      media: { upsert: jest.fn() },
    };
    const service = new DefaultAssetsService(
      stub<StorageProvider>(),
      stub<PrismaService>(prisma),
      stub<ConfigService>({ get: () => undefined }),
    );
    for (const n of ASSET_NAMES) {
      service['keys'].set(n, `defaults/${n}-${version}.webp`);
    }
    return { service, prisma, calls };
  };

  const run = async () => {
    const ctx = buildService();
    await ctx.service['repointOutdatedDefaults']();
    /** The update issued for one column, or a failure naming what is missing. */
    const callFor = (model: string, field: string): UpdateArgs => {
      const hit = ctx.calls.find(
        (c) => c.model === model && field in c.args.data,
      );
      if (!hit) throw new Error(`no ${model}.${field} update was issued`);
      return hit.args;
    };
    return { ...ctx, callFor };
  };

  /** Does a stored value satisfy the filter the service built? */
  const matches = (
    where: Record<string, unknown>,
    field: string,
    value: string | null,
  ) => {
    // [{ field: { startsWith } }, { NOT: { field: current } }]
    const [prefixClause, notClause] = where.AND as [
      Record<string, { startsWith: string }>,
      { NOT: Record<string, string> },
    ];
    const prefix = prefixClause[field].startsWith;
    const current = notClause.NOT[field];
    return (
      typeof value === 'string' && value.startsWith(prefix) && value !== current
    );
  };

  it('moves user avatars and community avatars onto the current version', async () => {
    const { callFor } = await run();

    expect(callFor('user', 'avatar').data.avatar).toBe(
      '/api/media/defaults/profile-avatar-v2.webp',
    );
    expect(callFor('community', 'avatarKey').data.avatarKey).toBe(
      '/api/media/defaults/community-avatar-v2.webp',
    );
  });

  it('selects exactly the rows still on an older default', async () => {
    const { callFor } = await run();
    const { where } = callFor('user', 'avatar');

    expect(
      matches(where, 'avatar', '/api/media/defaults/profile-avatar-v1.webp'),
    ).toBe(true);
    // Already current — updating it again would be pure write amplification.
    expect(
      matches(where, 'avatar', '/api/media/defaults/profile-avatar-v2.webp'),
    ).toBe(false);
  });

  it('cannot match a picture the user actually chose', async () => {
    // The whole safety argument: uploads never live under `defaults/`, so no
    // chosen image can satisfy the prefix, however it was stored.
    const { callFor } = await run();
    const { where } = callFor('user', 'avatar');

    for (const chosen of [
      '/api/media/covers/dfcb6659-8590-4643-93ad-d79f0e429c1b.webp',
      '/api/media/avatars/a307fc54.webp',
      'https://cdn.example.com/defaults/profile-avatar-v1.webp',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      '',
      null,
    ]) {
      expect(matches(where, 'avatar', chosen)).toBe(false);
    }
  });

  it('does not let one asset claim another asset rows', async () => {
    // `profile-avatar-` and `community-avatar-` must not overlap.
    const { callFor } = await run();
    const commAvatar = callFor('community', 'avatarKey').where;
    const userAvatar = callFor('user', 'avatar').where;

    expect(
      matches(
        commAvatar,
        'avatarKey',
        '/api/media/defaults/profile-avatar-v1.webp',
      ),
    ).toBe(false);
    expect(
      matches(
        userAvatar,
        'avatar',
        '/api/media/defaults/community-avatar-v1.webp',
      ),
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
    service['keys'].clear();
    await service['repointOutdatedDefaults']();

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.community.updateMany).not.toHaveBeenCalled();
  });
});
