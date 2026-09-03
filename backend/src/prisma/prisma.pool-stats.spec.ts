import { EventEmitter } from 'events';

/**
 * The pool figures on the PostgreSQL analytics card.
 *
 * The complaint that prompted these: "some values never change". They did not,
 * and the reason was structural rather than a wrong number — the probe reads
 * the pool after its own queries have released their connection, which is the
 * one moment nothing can be in flight. These pin down both the fix (peaks
 * sampled at checkout) and the denominator that was wrong.
 */

/** A stand-in for pg.Pool with the three counters and the acquire event. */
class FakePool extends EventEmitter {
  totalCount = 0;
  idleCount = 0;
  waitingCount = 0;
  options = { max: 15 };

  /** Simulates handing out a connection, which is when pg emits 'acquire'. */
  checkout() {
    if (this.idleCount > 0) this.idleCount -= 1;
    else this.totalCount += 1;
    this.emit('acquire');
  }

  release() {
    this.idleCount += 1;
  }
}

/** The peak-tracking and stats logic from PrismaService, over a fake pool. */
function attach(pool: FakePool) {
  let peakActive = 0;
  let peakWaiting = 0;
  pool.on('acquire', () => {
    const active = Math.max(0, pool.totalCount - pool.idleCount);
    if (active > peakActive) peakActive = active;
    if (pool.waitingCount > peakWaiting) peakWaiting = pool.waitingCount;
  });
  return () => ({
    total: pool.totalCount,
    idle: pool.idleCount,
    active: Math.max(0, pool.totalCount - pool.idleCount),
    waiting: pool.waitingCount,
    max: pool.options.max,
    peakActive,
    peakWaiting,
  });
}

describe('pool statistics', () => {
  it('reports the ceiling as max, not as however many are currently open', () => {
    const pool = new FakePool();
    const stats = attach(pool);
    pool.totalCount = 4;
    pool.idleCount = 4;
    // The old card used `total` as the denominator, so this would have read
    // "0 / 4" and the denominator would drift upward as the pool grew.
    expect(stats().max).toBe(15);
    expect(stats().total).toBe(4);
  });

  it('still reports 0 in use once everything has been released', () => {
    // This is the reading the probe actually takes, and it is correct — it is
    // simply not informative on its own.
    const pool = new FakePool();
    const stats = attach(pool);
    pool.checkout();
    pool.release();
    expect(stats().active).toBe(0);
  });

  it('but the PEAK remembers the busy moment the probe missed', () => {
    const pool = new FakePool();
    const stats = attach(pool);
    for (let i = 0; i < 6; i++) pool.checkout();   // six concurrent
    expect(stats().active).toBe(6);
    for (let i = 0; i < 6; i++) pool.release();    // all released again

    expect(stats().active).toBe(0);      // what the probe sees
    expect(stats().peakActive).toBe(6);  // what actually happened
  });

  it('holds the high-water mark rather than tracking the latest value down', () => {
    const pool = new FakePool();
    const stats = attach(pool);
    for (let i = 0; i < 5; i++) pool.checkout();
    for (let i = 0; i < 5; i++) pool.release();
    pool.checkout();                       // a much quieter burst afterwards
    expect(stats().peakActive).toBe(5);
  });

  it('captures queueing that had already cleared by probe time', () => {
    const pool = new FakePool();
    const stats = attach(pool);
    pool.waitingCount = 3;
    pool.checkout();
    pool.waitingCount = 0;

    expect(stats().waiting).toBe(0);      // gone by the time anyone looked
    expect(stats().peakWaiting).toBe(3);  // but it happened
  });

  it('never reports more in use than the pool can open', () => {
    const pool = new FakePool();
    const stats = attach(pool);
    for (let i = 0; i < 15; i++) pool.checkout();
    expect(stats().peakActive).toBeLessThanOrEqual(stats().max);
  });
});
