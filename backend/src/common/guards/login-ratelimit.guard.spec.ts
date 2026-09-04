import { ExecutionContext, HttpException } from '@nestjs/common';
import { LoginRateLimitGuard, loginAccountKey } from './login-ratelimit.guard';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { RedisService } from '../../redis/redis.service';

function makeService(): RateLimitService {
  return new RateLimitService({
    getClient: () => null,
  } as unknown as RedisService);
}

function ctx(request: any): ExecutionContext {
  const response = {
    headers: {} as Record<string, string>,
    setHeader(n: string, v: string) {
      this.headers[n] = v;
    },
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

const attempt = (identifier: string, ip = '203.0.113.7') => ({
  ip,
  headers: {},
  body: { identifier, password: 'x' },
});

describe('LoginRateLimitGuard', () => {
  describe('per-IP dimension', () => {
    it('stops password spraying from one host across many accounts', async () => {
      const guard = new LoginRateLimitGuard(makeService());

      // auth.login.ip is 10/300s — each attempt targets a DIFFERENT account, so
      // the account dimension never fires and only the IP budget can stop this.
      for (let i = 0; i < 10; i++) {
        await expect(
          guard.canActivate(ctx(attempt(`victim-${i}@example.edu`))),
        ).resolves.toBe(true);
      }

      await expect(
        guard.canActivate(ctx(attempt('victim-11@example.edu'))),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('per-account dimension', () => {
    /**
     * The gap the account dimension closes: a botnet spread over thousands of
     * addresses, each making a couple of attempts against ONE account. No
     * single IP ever reaches its limit, so the IP dimension alone never fires.
     */
    it('stops a distributed attack on one account from many IPs', async () => {
      const svc = makeService();
      const guard = new LoginRateLimitGuard(svc);
      const target = 'victim@example.edu';

      // Six failures, each from a different address.
      for (let i = 0; i < 6; i++) {
        await guard.canActivate(ctx(attempt(target, `198.51.100.${i}`)));
        await svc.penalize('auth.login.account', target); // the controller's job
      }

      // A seventh address is refused purely on the account budget.
      await expect(
        guard.canActivate(ctx(attempt(target, '198.51.100.200'))),
      ).rejects.toThrow(HttpException);
    });

    /**
     * The reason the guard only CHECKS this budget and the controller spends it:
     * consuming on the way in would let a user lock themselves out of their own
     * account by signing in successfully.
     */
    it('never charges the account budget for successful logins', async () => {
      const guard = new LoginRateLimitGuard(makeService());
      const me = 'me@example.edu';

      // 20 successful sign-ins — nothing penalizes, so nothing is spent.
      for (let i = 0; i < 20; i++) {
        await expect(
          guard.canActivate(ctx(attempt(me, `192.0.2.${i}`))),
        ).resolves.toBe(true);
      }
    });

    it('treats the account budget as independent per target', async () => {
      const svc = makeService();
      const guard = new LoginRateLimitGuard(svc);

      for (let i = 0; i < 6; i++) {
        await svc.penalize('auth.login.account', 'a@example.edu');
      }

      await expect(
        guard.canActivate(ctx(attempt('a@example.edu', '192.0.2.1'))),
      ).rejects.toThrow(HttpException);
      await expect(
        guard.canActivate(ctx(attempt('b@example.edu', '192.0.2.2'))),
      ).resolves.toBe(true);
    });
  });

  describe('enumeration safety', () => {
    it('returns no RateLimit-Remaining header on a sensitive policy', async () => {
      const guard = new LoginRateLimitGuard(makeService());
      const context = ctx(attempt('someone@example.edu'));
      const response: any = context.switchToHttp().getResponse();

      await guard.canActivate(context);

      // Telling a prober how many attempts remain tells them exactly when to
      // rotate address.
      expect(response.headers['RateLimit']).toBeUndefined();
      expect(response.headers['RateLimit-Policy']).toBeUndefined();
    });

    it('gives the same message whether or not the account exists', async () => {
      const svc = makeService();
      const guard = new LoginRateLimitGuard(svc);

      const messages: string[] = [];
      for (const target of ['real@example.edu', 'nobody@example.edu']) {
        for (let i = 0; i < 6; i++) {
          await svc.penalize('auth.login.account', target);
        }
        try {
          await guard.canActivate(ctx(attempt(target, '192.0.2.50')));
        } catch (e) {
          const b = (e as HttpException).getResponse() as { message: string };
          messages.push(b.message);
        }
      }

      expect(messages).toHaveLength(2);
      expect(messages[0]).toBe(messages[1]);
    });
  });

  describe('loginAccountKey', () => {
    it('normalises so casing and padding share one bucket', () => {
      expect(
        loginAccountKey({ body: { identifier: '  Alice@Example.EDU ' } }),
      ).toBe('alice@example.edu');
    });

    it('returns null when there is nothing to key on', () => {
      expect(loginAccountKey({ body: {} })).toBeNull();
      expect(loginAccountKey({})).toBeNull();
      expect(loginAccountKey({ body: { identifier: 42 } })).toBeNull();
    });
  });
});
