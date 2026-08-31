import { VerificationStatus } from '@prisma/client';
import { VerificationAccessService } from './verification-access.service';

/**
 * Latency characterisation for the verification gate.
 *
 * Not a pass/fail performance test in CI terms — the thresholds are loose
 * enough to be stable on any machine. Its job is to keep the *shape* honest:
 * the gate must be O(1) database round-trips per user per window, not one per
 * request, and never one per participant.
 */
describe('VerificationAccessService — latency profile', () => {
  const DB_LATENCY_MS = 2; // stand-in for a real round-trip
  let queries: number;
  let service: VerificationAccessService;

  const percentile = (xs: number[], p: number) =>
    [...xs].sort((a, b) => a - b)[
      Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))
    ];

  beforeEach(() => {
    delete process.env.FEATURE_VERIFICATION_ENABLED;
    queries = 0;
    const delay = () => new Promise((r) => setTimeout(r, DB_LATENCY_MS));
    const prisma: any = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          queries++;
          await delay();
          return {
            id: where.id,
            verificationStatus: VerificationStatus.VERIFIED,
          };
        }),
        findMany: jest.fn(async ({ where }: any) => {
          queries++;
          await delay();
          return where.id.in.map((id: string) => ({
            id,
            verificationStatus: VerificationStatus.VERIFIED,
          }));
        }),
      },
      conversationParticipant: { findMany: jest.fn(async () => []) },
    };
    service = new VerificationAccessService(prisma, { emit: jest.fn() } as any);
    service.invalidateAll();
  });

  it('costs one query per user per window, not one per request', async () => {
    const N = 500;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      await service.isUserEligible('hot-user');
      samples.push(performance.now() - t);
    }

    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);

    console.log(
      `[verification gate] n=${N} queries=${queries} ` +
        `p50=${p50.toFixed(4)}ms p95=${p95.toFixed(4)}ms p99=${p99.toFixed(4)}ms`,
    );

    // The whole point: 500 gated requests, one database read.
    expect(queries).toBe(1);
    // Steady-state cost is a Map lookup, comfortably under the round-trip it
    // replaced even with a generous margin for a loaded CI box.
    expect(p95).toBeLessThan(DB_LATENCY_MS);
  });

  it('quantifies what the cache removed from every gated request', async () => {
    const N = 200;
    const uncached: number[] = [];
    for (let i = 0; i < N; i++) {
      // Evicting before each call reproduces the previous behaviour exactly:
      // one user.findUnique per @VerifiedOnly() request.
      service.invalidateAll();
      const t = performance.now();
      await service.isUserEligible('hot-user');
      uncached.push(performance.now() - t);
    }
    const beforeQueries = queries;

    queries = 0;
    service.invalidateAll();
    const cached: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      await service.isUserEligible('hot-user');
      cached.push(performance.now() - t);
    }

    console.log(
      `[verification gate] before: queries=${beforeQueries} ` +
        `p50=${percentile(uncached, 50).toFixed(3)}ms p95=${percentile(uncached, 95).toFixed(3)}ms ` +
        `p99=${percentile(uncached, 99).toFixed(3)}ms\n` +
        `[verification gate] after:  queries=${queries} ` +
        `p50=${percentile(cached, 50).toFixed(4)}ms p95=${percentile(cached, 95).toFixed(4)}ms ` +
        `p99=${percentile(cached, 99).toFixed(4)}ms`,
    );

    expect(beforeQueries).toBe(N);
    expect(queries).toBe(1);
    expect(percentile(cached, 95)).toBeLessThan(percentile(uncached, 50));
  });

  it('checks a whole conversation in one query regardless of participant count', async () => {
    const participants = Array.from({ length: 50 }, (_, i) => `member-${i}`);

    const t = performance.now();
    await service.getEligibilityMap(participants);
    const elapsed = performance.now() - t;

    console.log(
      `[verification gate] 50 participants queries=${queries} elapsed=${elapsed.toFixed(2)}ms`,
    );
    // Batched, not N+1 — an N+1 here would be 50 round-trips on every group send.
    expect(queries).toBe(1);
  });

  it('adds no query at all when enforcement is disabled', async () => {
    process.env.FEATURE_VERIFICATION_ENABLED = 'false';
    for (let i = 0; i < 100; i++) await service.isUserEligible(`u${i}`);
    await service.getEligibilityMap(['a', 'b', 'c']);
    expect(queries).toBe(0);
  });
});
