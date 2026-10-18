import { TrendingService } from './trending.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { CampusAccessService } from '../common/campus/campus-access.service';

/**
 * The SQL is verified against a real database; these pin the campus →
 * everywhere fallback and the per-college cache.
 */
describe('TrendingService', () => {
  const tag = (name: string) => ({ name, posts: 3, authors: 2 });

  const build = (
    rowsByCollege: Record<string, ReturnType<typeof tag>[]>,
    collegeId: string | null,
  ) => {
    const store = new Map<string, string>();
    const queryRaw = jest.fn((_sql: unknown, ...values: unknown[]) => {
      // The college id is the first non-Date bound value (null = everywhere).
      const college = values.find((v) => !(v instanceof Date));
      return Promise.resolve(
        rowsByCollege[typeof college === 'string' ? college : 'everywhere'] ??
          [],
      );
    });
    const getActiveCollegeId = jest.fn<Promise<string | null>, [string]>(() =>
      Promise.resolve(collegeId),
    );
    const service = new TrendingService(
      stub<PrismaService>({ $queryRaw: queryRaw }),
      stub<RedisService>({
        getClient: () =>
          ({
            get: (k: string) => Promise.resolve(store.get(k) ?? null),
            set: (k: string, v: string) => {
              store.set(k, v);
              return Promise.resolve('OK');
            },
          }) as never,
      }),
      // The campus comes from the active affiliation, not User.collegeId.
      stub<CampusAccessService>({ getActiveCollegeId }),
    );
    return { service, queryRaw, store, getActiveCollegeId };
  };

  it('returns the campus list when the campus has trends', async () => {
    const { service } = build({ c1: [tag('hackathon')] }, 'c1');
    expect(await service.forUser('me')).toEqual({
      scope: 'campus',
      tags: [tag('hackathon')],
    });
  });

  it('falls back to everywhere when the campus is quiet', async () => {
    const { service } = build({ c1: [], everywhere: [tag('freshers')] }, 'c1');
    expect(await service.forUser('me')).toEqual({
      scope: 'everywhere',
      tags: [tag('freshers')],
    });
  });

  it('uses everywhere for a viewer with no college', async () => {
    const { service } = build({ everywhere: [tag('freshers')] }, null);
    expect((await service.forUser('me')).scope).toBe('everywhere');
  });

  it('serves a campus from cache after the first computation', async () => {
    const { service, queryRaw, store } = build(
      { c1: [tag('hackathon')] },
      'c1',
    );
    await service.forUser('me');
    // The write is fire-and-forget; let it land.
    await new Promise((r) => setImmediate(r));
    await service.forUser('someone-else');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect([...store.keys()]).toEqual(['trending:v2:c1']);
  });

  it('reads the campus from the affiliation and counts affiliated authors', async () => {
    const { service, queryRaw, getActiveCollegeId } = build(
      { c1: [tag('hackathon')] },
      'c1',
    );
    await service.forUser('me');
    expect(getActiveCollegeId).toHaveBeenCalledWith('me');
    const sql = (queryRaw.mock.calls[0][0] as readonly string[]).join('?');
    expect(sql).toContain('"CollegeAffiliation"');
    expect(sql).not.toContain('u."collegeId" =');
  });
});
