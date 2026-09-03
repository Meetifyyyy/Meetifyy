import { EmailUsageService } from './email-usage.service';

/**
 * The daily counter. Two properties matter: it must key by UTC day so replicas
 * in different regions agree, and it must never let a Redis problem turn a
 * delivered email into a failed job.
 */

class FakeRedis {
  store = new Map<string, number>();
  expires = new Map<string, number>();
  failMode: 'none' | 'throw' = 'none';

  multi() {
    const ops: Array<() => void> = [];
    const chain: any = {
      incr: (k: string) => { ops.push(() => this.store.set(k, (this.store.get(k) ?? 0) + 1)); return chain; },
      expire: (k: string, s: number) => { ops.push(() => this.expires.set(k, s)); return chain; },
      exec: async () => {
        if (this.failMode === 'throw') throw new Error('redis down');
        ops.forEach((op) => op());
        return [];
      },
    };
    return chain;
  }

  async get(key: string) {
    if (this.failMode === 'throw') throw new Error('redis down');
    const v = this.store.get(key);
    return v === undefined ? null : String(v);
  }
}

const makeService = (client: FakeRedis | null) =>
  new EmailUsageService({ getClient: () => client } as any);

const todayKey = (provider: string) =>
  `email:sent:${provider}:${new Date().toISOString().slice(0, 10)}`;

describe('EmailUsageService', () => {
  it('counts a send against the provider that made it', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis);
    await svc.recordSent('resend');
    await svc.recordSent('resend');
    await svc.recordSent('smtp');

    expect(redis.store.get(todayKey('resend'))).toBe(2);
    expect(redis.store.get(todayKey('smtp'))).toBe(1);
  });

  it('keeps the providers separate when reading back', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis);
    await svc.recordSent('resend');
    await svc.recordSent('smtp');
    await svc.recordSent('smtp');

    expect(await svc.getSentToday('resend')).toBe(1);
    expect(await svc.getSentToday('smtp')).toBe(2);
  });

  it('reports zero for a provider that has sent nothing today', async () => {
    const svc = makeService(new FakeRedis());
    expect(await svc.getSentToday('resend')).toBe(0);
  });

  it('sets an expiry alongside the increment, so keys cannot accumulate', async () => {
    const redis = new FakeRedis();
    await makeService(redis).recordSent('resend');
    expect(redis.expires.get(todayKey('resend'))).toBe(8 * 24 * 60 * 60);
  });

  it('keys by UTC day, so replicas in different regions agree', async () => {
    const redis = new FakeRedis();
    await makeService(redis).recordSent('resend');
    const [key] = [...redis.store.keys()];
    expect(key).toMatch(/^email:sent:resend:\d{4}-\d{2}-\d{2}$/);
    expect(key.endsWith(new Date().toISOString().slice(0, 10))).toBe(true);
  });

  it('says "cannot tell" rather than zero when Redis is unavailable', async () => {
    // A confident 0 during a Redis outage would read as an email outage.
    expect(await makeService(null).getSentToday('resend')).toBeNull();

    const failing = new FakeRedis();
    failing.failMode = 'throw';
    expect(await makeService(failing).getSentToday('resend')).toBeNull();
  });

  it('never throws from recordSent, whatever Redis does', async () => {
    // A counter that cannot be written must not fail an email that was sent.
    await expect(makeService(null).recordSent('resend')).resolves.toBeUndefined();

    const failing = new FakeRedis();
    failing.failMode = 'throw';
    await expect(makeService(failing).recordSent('resend')).resolves.toBeUndefined();
  });
});
