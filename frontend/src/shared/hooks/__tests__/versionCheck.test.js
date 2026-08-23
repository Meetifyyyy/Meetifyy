import { describe, it, expect, vi } from 'vitest';

/**
 * The two guards that stop the update reload firing twice.
 *
 * Both are plain concurrency logic, reproduced here rather than imported,
 * because the module commits a real navigation and latches for the lifetime
 * of the document — it cannot be exercised twice in one test file.
 *
 * The failure they fix: returning to a tab fires `visibilitychange` AND
 * `focus`, so two checks ran milliseconds apart, both saw the same new
 * version, and both navigated. The user sees the app reload twice.
 */

/** The in-flight coalescing: concurrent callers share one check. */
function makeChecker(work) {
  let inFlight = null;
  return () => {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(work)
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}

/** The reload latch: at most one navigation per document. */
function makeReloader(navigate) {
  let committed = false;
  return () => {
    if (committed) return;
    committed = true;
    navigate();
  };
}

describe('concurrent version checks', () => {
  it('fetches once when several triggers fire together', async () => {
    const work = vi.fn(async () => 'v2');
    const check = makeChecker(work);

    // focus + visibilitychange + online, all in the same tick.
    await Promise.all([check(), check(), check()]);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh check once the previous one settles', async () => {
    const work = vi.fn(async () => 'v2');
    const check = makeChecker(work);

    await check();
    await check();

    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not wedge after a failed check', async () => {
    // A check that throws while offline must not block every later one.
    const work = vi.fn(async () => { throw new Error('offline'); });
    const check = makeChecker(work);

    await check().catch(() => {});
    await check().catch(() => {});

    expect(work).toHaveBeenCalledTimes(2);
  });
});

describe('the reload latch', () => {
  it('navigates once however many callers reach it', () => {
    const navigate = vi.fn();
    const reload = makeReloader(navigate);

    reload(); reload(); reload();

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('stays latched even if callers arrive much later', () => {
    const navigate = vi.fn();
    const reload = makeReloader(navigate);

    reload();
    // The interval tick that lands while the navigation is still pending.
    reload();

    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('retry accounting', () => {
  const MAX = 2;
  const shouldRetry = (attempts) => attempts < MAX;

  it('permits a second attempt, in case the first landed on the old bundle', () => {
    // A service worker still controlling the client can serve stale HTML to
    // the reload itself; one more try is the escape hatch.
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(1)).toBe(true);
  });

  it('stops after the cap, so a bad deploy cannot loop the client', () => {
    expect(shouldRetry(2)).toBe(false);
    expect(shouldRetry(9)).toBe(false);
  });
});
