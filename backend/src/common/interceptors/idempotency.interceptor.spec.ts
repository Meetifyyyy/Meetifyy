import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Redis } from 'ioredis';
import { lastValueFrom, Observable, of, throwError } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../../redis/redis.service';
import { stub } from '../testing/stub';
import {
  COMPLETE_SCRIPT,
  IdempotencyInterceptor,
  REFRESH_SCRIPT,
  RELEASE_SCRIPT,
} from './idempotency.interceptor';

/**
 * A write carrying an Idempotency-Key happens once.
 *
 * Reported shape of the bug: a post (or comment, group chat, activity, support
 * ticket) whose response was lost was created again when it was retried — by
 * the client's failover, which re-sends the same POST, or by a user tapping
 * again after a timeout. The fake below implements just the Redis commands the
 * interceptor uses, with their real NX semantics, so these tests run the
 * interceptor's own claim/replay/release logic.
 */
function fakeRedis() {
  const data = new Map<string, string>();
  /** Expiry per key, in Date.now() ms; honoured by every read. */
  const expires = new Map<string, number>();
  const live = (key: string): string | undefined => {
    const at = expires.get(key);
    if (at !== undefined && Date.now() >= at) {
      data.delete(key);
      expires.delete(key);
    }
    return data.get(key);
  };
  const ttlFrom = (args: unknown[]): number | undefined => {
    const i = args.indexOf('EX');
    return i >= 0 ? Number(args[i + 1]) : undefined;
  };
  const write = (key: string, value: string, ttl: number | undefined) => {
    data.set(key, value);
    if (ttl === undefined) expires.delete(key);
    else expires.set(key, Date.now() + ttl * 1000);
  };
  const client = {
    set: jest.fn((key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && live(key) !== undefined) {
        return Promise.resolve(null);
      }
      write(key, value, ttlFrom(args));
      return Promise.resolve('OK');
    }),
    get: jest.fn((key: string) => Promise.resolve(live(key) ?? null)),
    del: jest.fn((key: string) => {
      const had = live(key) !== undefined;
      data.delete(key);
      expires.delete(key);
      return Promise.resolve(had ? 1 : 0);
    }),
    /** The interceptor's Lua scripts, with their real compare-and-act semantics. */
    eval: jest.fn(
      (script: string, _numKeys: number, key: string, ...argv: unknown[]) => {
        const own = live(key) === argv[0];
        if (!own) return Promise.resolve(0);
        if (script === RELEASE_SCRIPT) {
          data.delete(key);
          expires.delete(key);
        } else if (script === COMPLETE_SCRIPT) {
          write(key, String(argv[1]), Number(argv[2]));
        } else if (script === REFRESH_SCRIPT) {
          expires.set(key, Date.now() + Number(argv[1]) * 1000);
        } else {
          return Promise.reject(new Error('unknown script'));
        }
        return Promise.resolve(1);
      },
    ),
  };
  const redis = stub<RedisService>({
    getClient: () => client as unknown as Redis,
  });
  return { redis, data };
}

type FakeRequest = {
  method: string;
  headers: Record<string, string>;
  body: unknown;
  user?: { id: string };
  baseUrl: string;
  path: string;
  ip: string;
};

class FakeController {
  create(): void {}
}

function contextFor(req: FakeRequest) {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  };
  const ctx = stub<ExecutionContext>({
    getType: () => 'http',
    getClass: () => FakeController,
    getHandler: () => FakeController.prototype.create,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  });
  return { ctx, headers };
}

const post = (overrides: Partial<FakeRequest> = {}): FakeRequest => ({
  method: 'POST',
  headers: { 'idempotency-key': 'key-0000000001' },
  body: { text: 'hello' },
  user: { id: 'user-1' },
  baseUrl: '',
  path: '/api/posts',
  ip: '10.0.0.1',
  ...overrides,
});

/** A handler that counts how many times the write actually ran. */
function handler(result: unknown = { id: 'post-1' }) {
  const run = jest.fn(() => of(result));
  const next: CallHandler<unknown> = { handle: run };
  return { next, run };
}

const call = (
  interceptor: IdempotencyInterceptor,
  req: FakeRequest,
  next: CallHandler<unknown>,
) => {
  const { ctx, headers } = contextFor(req);
  const out: Observable<unknown> = interceptor.intercept(ctx, next);
  return { result: lastValueFrom(out), headers };
};

/** Every route under test has opted in with @Idempotent(), unless a test says otherwise. */
const optedIn = stub<Reflector>({ getAllAndOverride: () => true as never });
const notOptedIn = stub<Reflector>({
  getAllAndOverride: () => undefined as never,
});

describe('IdempotencyInterceptor', () => {
  it('runs the write once and replays its result for a repeat', async () => {
    const { redis } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next, run } = handler();

    const first = call(interceptor, post(), next);
    await expect(first.result).resolves.toEqual({ id: 'post-1' });
    const second = call(interceptor, post(), next);
    await expect(second.result).resolves.toEqual({ id: 'post-1' });

    expect(run).toHaveBeenCalledTimes(1);
    expect(second.headers['Idempotent-Replayed']).toBe('true');
  });

  it('waits for a repeat that arrives while the first is still running', async () => {
    const { redis } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    let finish: (v: unknown) => void = () => {};
    const slow: CallHandler<unknown> = {
      handle: jest.fn(
        () =>
          new Observable<unknown>((sub) => {
            finish = (v) => {
              sub.next(v);
              sub.complete();
            };
          }),
      ),
    };

    const first = call(interceptor, post(), slow);
    // Let the first request take the key before the repeat arrives.
    await new Promise((r) => setTimeout(r, 0));
    const second = call(interceptor, post(), slow);
    finish({ id: 'post-1' });

    await expect(first.result).resolves.toEqual({ id: 'post-1' });
    await expect(second.result).resolves.toEqual({ id: 'post-1' });
    expect(slow.handle).toHaveBeenCalledTimes(1);
  });

  it('lets a retry run for real after the first attempt failed', async () => {
    const { redis } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const failing: CallHandler<unknown> = {
      handle: () => throwError(() => new Error('db down')),
    };
    await expect(call(interceptor, post(), failing).result).rejects.toThrow(
      'db down',
    );

    const { next, run } = handler();
    await expect(call(interceptor, post(), next).result).resolves.toEqual({
      id: 'post-1',
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses the same key with a different body', async () => {
    const { redis } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next } = handler();
    await call(interceptor, post(), next).result;

    await expect(
      call(interceptor, post({ body: { text: 'other' } }), next).result,
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('never returns one user’s result to another user', async () => {
    const { redis } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const a = handler({ id: 'post-a' });
    const b = handler({ id: 'post-b' });
    await call(interceptor, post(), a.next).result;

    await expect(
      call(interceptor, post({ user: { id: 'user-2' } }), b.next).result,
    ).resolves.toEqual({ id: 'post-b' });
    expect(b.run).toHaveBeenCalledTimes(1);
  });

  it('scopes a key to its route', async () => {
    const { redis } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const a = handler({ id: 'post-1' });
    const b = handler({ id: 'comment-1' });
    await call(interceptor, post(), a.next).result;
    await expect(
      call(interceptor, post({ path: '/api/posts/p1/comments' }), b.next)
        .result,
    ).resolves.toEqual({ id: 'comment-1' });
  });

  it('leaves requests without a key, reads, and a missing Redis alone', async () => {
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next, run } = handler();

    await call(interceptor, post({ headers: {} }), next).result;
    await call(interceptor, post({ headers: {} }), next).result;
    await call(interceptor, post({ method: 'GET' }), next).result;
    expect(run).toHaveBeenCalledTimes(3);
    expect(data.size).toBe(0);

    const noRedis = new IdempotencyInterceptor(
      stub<RedisService>({ getClient: () => null }),
      optedIn,
    );
    await call(noRedis, post(), next).result;
    await call(noRedis, post(), next).result;
    expect(run).toHaveBeenCalledTimes(5);
  });

  it('rejects a malformed key instead of trusting it', () => {
    const { redis } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next } = handler();
    expect(() =>
      call(
        interceptor,
        post({ headers: { 'idempotency-key': 'bad key!' } }),
        next,
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('refuses a repeat that waited past the limit rather than running twice', async () => {
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    // A first attempt that never finishes, as far as this repeat can tell,
    // for the same body (so the repeat waits rather than being a mismatch).
    data.set(
      'idem:v1:u:user-1:POST:/api/posts:key-0000000001',
      JSON.stringify({
        state: 'pending',
        fingerprint: createHash('sha256')
          .update(JSON.stringify({ body: { text: 'hello' }, query: {} }))
          .digest('hex'),
      }),
    );
    jest.useFakeTimers();
    const { next, run } = handler();
    const pending = call(interceptor, post(), next).result;
    const settled = expect(pending).rejects.toBeInstanceOf(ConflictException);
    await jest.advanceTimersByTimeAsync(IdempotencyInterceptor.WAIT_MS + 500);
    await settled;
    jest.useRealTimers();
    expect(run).not.toHaveBeenCalled();
    const err: unknown = await pending.catch((e: unknown) => e);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
    });
  });
});

describe('IdempotencyInterceptor — handlers that write their own response', () => {
  it('leaves an @Res() handler alone, since a replay could never reach the client', async () => {
    const { Controller, Put, Res } = await import('@nestjs/common');
    @Controller('uploads')
    class Uploads {
      @Put('direct-upload')
      upload(@Res() _res: unknown): void {}
    }
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next, run } = handler();
    const ctx = stub<ExecutionContext>({
      getType: () => 'http',
      getClass: () => Uploads,
      getHandler: () => Uploads.prototype.upload,
      switchToHttp: () => ({
        getRequest: () =>
          post({ method: 'PUT', path: '/api/uploads/direct-upload' }),
        getResponse: () => ({ setHeader: () => {} }),
      }),
    });
    await lastValueFrom(interceptor.intercept(ctx, next));
    await lastValueFrom(interceptor.intercept(ctx, next));
    expect(run).toHaveBeenCalledTimes(2);
    expect(data.size).toBe(0);
  });
});

describe('IdempotencyInterceptor — what it must never store or block', () => {
  it('leaves a passthrough @Res() handler alone: cookies and tokens cannot be replayed', async () => {
    const { Controller, Post, Res } = await import('@nestjs/common');
    @Controller('auth')
    class Auth {
      @Post('session/adopt')
      adopt(@Res({ passthrough: true }) _res: unknown): void {}
    }
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next, run } = handler({ accessToken: 'secret' });
    const ctx = stub<ExecutionContext>({
      getType: () => 'http',
      getClass: () => Auth,
      getHandler: () => Auth.prototype.adopt,
      switchToHttp: () => ({
        getRequest: () => post({ path: '/api/auth/session/adopt' }),
        getResponse: () => ({ setHeader: () => {} }),
      }),
    });
    await lastValueFrom(interceptor.intercept(ctx, next));
    await lastValueFrom(interceptor.intercept(ctx, next));
    expect(run).toHaveBeenCalledTimes(2);
    expect(data.size).toBe(0);
  });

  it('skips auth paths by name too', async () => {
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next, run } = handler({ csrfToken: 't' });
    await call(interceptor, post({ path: '/api/admin/auth/verify-otp' }), next)
      .result;
    await call(interceptor, post({ path: '/api/admin/auth/verify-otp' }), next)
      .result;
    expect(run).toHaveBeenCalledTimes(2);
    expect(data.size).toBe(0);
  });

  it('claims with a short lifetime, so a crashed request frees its key within a minute', async () => {
    const { redis } = fakeRedis();
    const client = redis.getClient() as unknown as {
      set: jest.Mock;
      eval: jest.Mock;
    };
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next } = handler();
    await call(interceptor, post(), next).result;
    const [claim] = client.set.mock.calls as unknown[][];
    const [done] = client.eval.mock.calls as unknown[][];
    expect(claim).toContain(IdempotencyInterceptor.PENDING_TTL_SECONDS);
    expect(done[0]).toBe(COMPLETE_SCRIPT);
    expect(done).toContain(IdempotencyInterceptor.TTL_SECONDS);
  });

  it('drops an unreadable entry and runs, instead of spinning on it', async () => {
    const { redis, data } = fakeRedis();
    data.set('idem:v1:u:user-1:POST:/api/posts:key-0000000001', 'not json');
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next, run } = handler();
    await expect(call(interceptor, post(), next).result).resolves.toEqual({
      id: 'post-1',
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('frees the key when the result is too large to keep', async () => {
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const big = { blob: 'x'.repeat(IdempotencyInterceptor.MAX_BODY_BYTES + 1) };
    const { next } = handler(big);
    await call(interceptor, post(), next).result;
    expect(data.size).toBe(0);
  });
});

describe('IdempotencyInterceptor — a claim belongs to the request that took it', () => {
  const KEY = 'idem:v1:u:user-1:POST:/api/posts:key-0000000001';

  /** A handler that finishes (or fails) only when the test says so. */
  function controllable() {
    let settle: (ok: boolean, v?: unknown) => void = () => {};
    const next: CallHandler<unknown> = {
      handle: jest.fn(
        () =>
          new Observable<unknown>((sub) => {
            settle = (ok, v) => {
              if (ok) {
                sub.next(v);
                sub.complete();
              } else sub.error(new Error('db down'));
            };
          }),
      ),
    };
    return { next, settle: (ok: boolean, v?: unknown) => settle(ok, v) };
  }

  afterEach(() => jest.useRealTimers());

  it('a failing first request does not delete a second claimant’s key', async () => {
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const first = controllable();
    const firstResult = call(interceptor, post(), first.next).result;
    await new Promise((r) => setTimeout(r, 0));
    // The first claim lapses (as if it had expired) and a retry claims again.
    data.delete(KEY);
    const second = controllable();
    const secondResult = call(interceptor, post(), second.next).result;
    await new Promise((r) => setTimeout(r, 0));
    const secondClaim = data.get(KEY);
    expect(secondClaim).toBeDefined();

    first.settle(false);
    await expect(firstResult).rejects.toThrow('db down');
    expect(data.get(KEY)).toBe(secondClaim);

    second.settle(true, { id: 'post-2' });
    await expect(secondResult).resolves.toEqual({ id: 'post-2' });
  });

  it('a late first request does not overwrite another claim with its result', async () => {
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const first = controllable();
    const firstResult = call(interceptor, post(), first.next).result;
    await new Promise((r) => setTimeout(r, 0));
    data.delete(KEY);
    const second = controllable();
    const secondResult = call(interceptor, post(), second.next).result;
    await new Promise((r) => setTimeout(r, 0));
    const secondClaim = data.get(KEY);

    first.settle(true, { id: 'post-1' });
    await expect(firstResult).resolves.toEqual({ id: 'post-1' });
    expect(data.get(KEY)).toBe(secondClaim);

    second.settle(true, { id: 'post-2' });
    await secondResult;
    expect(JSON.parse(data.get(KEY) ?? 'null')).toMatchObject({
      state: 'done',
      body: { id: 'post-2' },
    });
  });

  it('gives each claim its own random token', async () => {
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const a = controllable();
    void call(interceptor, post(), a.next).result.catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    const claimA = JSON.parse(data.get(KEY) ?? '{}') as { token?: string };
    data.delete(KEY);
    const b = controllable();
    void call(interceptor, post(), b.next).result.catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    const claimB = JSON.parse(data.get(KEY) ?? '{}') as { token?: string };
    expect(claimA.token).toMatch(/^[0-9a-f]{32}$/);
    expect(claimB.token).toMatch(/^[0-9a-f]{32}$/);
    expect(claimA.token).not.toBe(claimB.token);
    a.settle(false);
    b.settle(false);
  });

  it('keeps refreshing a long request’s claim, so a retry waits instead of running twice', async () => {
    jest.useFakeTimers();
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const first = controllable();
    const firstResult = call(interceptor, post(), first.next).result;
    await jest.advanceTimersByTimeAsync(0);

    // Well past the claim's own lifetime: still held.
    await jest.advanceTimersByTimeAsync(
      IdempotencyInterceptor.PENDING_TTL_SECONDS * 1000 * 3,
    );
    expect(data.has(KEY)).toBe(true);
    const repeat = handler();
    const repeatResult = call(interceptor, post(), repeat.next).result;
    await jest.advanceTimersByTimeAsync(IdempotencyInterceptor.POLL_MS);
    first.settle(true, { id: 'post-1' });
    await jest.advanceTimersByTimeAsync(IdempotencyInterceptor.POLL_MS);
    await expect(firstResult).resolves.toEqual({ id: 'post-1' });
    await expect(repeatResult).resolves.toEqual({ id: 'post-1' });
    expect(repeat.run).not.toHaveBeenCalled();
  });

  it('stops refreshing once the request ends, and a dead claim still expires', async () => {
    jest.useFakeTimers();
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const client = redis.getClient() as unknown as Redis & { eval: jest.Mock };
    const { next } = handler();
    await call(interceptor, post(), next).result;
    const calls = client.eval.mock.calls.length;
    await jest.advanceTimersByTimeAsync(
      IdempotencyInterceptor.PENDING_TTL_SECONDS * 1000 * 3,
    );
    expect(client.eval.mock.calls.length).toBe(calls);

    // A claim nobody refreshes (its process died) lapses on its own.
    data.delete(KEY);
    await client.set(
      KEY,
      'x',
      'EX',
      IdempotencyInterceptor.PENDING_TTL_SECONDS,
      'NX',
    );
    await jest.advanceTimersByTimeAsync(
      IdempotencyInterceptor.PENDING_TTL_SECONDS * 1000 + 1,
    );
    await expect(client.set(KEY, 'y', 'NX')).resolves.toBe('OK');
  });
});

describe('IdempotencyInterceptor — opt-in only', () => {
  it('stores and replays nothing for a route without @Idempotent()', async () => {
    const { redis, data } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, notOptedIn);
    const { next, run } = handler();
    await call(interceptor, post(), next).result;
    await call(interceptor, post(), next).result;
    expect(run).toHaveBeenCalledTimes(2);
    expect(data.size).toBe(0);
  });
});

describe('IdempotencyInterceptor — the query string is part of the request', () => {
  it('refuses a reused key whose request differs only in its query', async () => {
    const { redis } = fakeRedis();
    const interceptor = new IdempotencyInterceptor(redis, optedIn);
    const { next } = handler({ id: 'conversation-with-a' });
    const toA = {
      ...post({ body: {} }),
      query: { userIds: 'a' },
    } as FakeRequest;
    const toB = {
      ...post({ body: {} }),
      query: { userIds: 'b' },
    } as FakeRequest;
    await call(interceptor, toA, next).result;
    await expect(call(interceptor, toB, next).result).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
