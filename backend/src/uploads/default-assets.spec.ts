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
      community: { updateMany: jest.fn(async (args: any) => { communities.push(args); return { count: 1 }; }) },
      user: { updateMany: jest.fn(async (args: any) => { users.push(args); return { count: 1 }; }) },
      media: { upsert: jest.fn() },
    };
    const service = new DefaultAssetsService(
      {} as any,
      prisma as any,
      { get: () => undefined } as any,
    );
    // Pretend the four assets published successfully.
    for (const n of ['community-cover', 'profile-cover', 'community-avatar', 'profile-avatar']) {
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

    expect(coverCall.where).toEqual({ OR: [{ coverKey: null }, { coverKey: '' }] });
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
    expect(communities.map((c) => Object.keys(c.data)[0]).sort()).toEqual(['avatarKey', 'coverKey']);
    expect(users.map((c) => Object.keys(c.data)[0]).sort()).toEqual(['avatar', 'cover']);
  });

  it('writes an /api/media/ reference, the same shape an upload gets', async () => {
    // Anything else and downstream code could tell a default from a real
    // upload — which is the one thing this feature must not allow.
    const { communities } = await run();
    for (const call of communities) {
      expect(Object.values(call.data)[0]).toMatch(/^\/api\/media\/defaults\/.+\.webp$/);
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
