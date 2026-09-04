import { ExecutionContext, HttpException } from '@nestjs/common';
import { RateLimitGuard } from './ratelimit.guard';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { RedisService } from '../../redis/redis.service';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';

function makeService(): RateLimitService {
  return new RateLimitService({
    getClient: () => null,
  } as unknown as RedisService);
}

/** A JwtGuard stand-in that verifies nothing but a token→id mapping. */
function makeJwt(map: Record<string, string>) {
  return {
    peekUserId: async (token: string) => map[token] ?? null,
  } as any;
}

function ctx(request: any): ExecutionContext {
  const response = {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
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

function authed(token: string, ip = '203.0.113.7') {
  return {
    ip,
    path: '/api/posts/feed',
    headers: { authorization: `Bearer ${token}` },
  };
}

describe('RateLimitGuard', () => {
  describe('identifier resolution', () => {
    /**
     * THE bug this guard was rewritten for.
     *
     * It keyed on `request.user?.id || request.ip`. `request.user` is populated
     * by JwtGuard — a ROUTE guard, which Nest runs after global guards — so it
     * was undefined here for essentially every request, and everything fell to
     * the IP branch. With `trust proxy` unset that IP was the reverse proxy, so
     * the whole platform shared one 100/min bucket.
     *
     * Two different users behind the same address must now get separate budgets.
     */
    it('counts authenticated users separately even from the same IP', async () => {
      const svc = makeService();
      const guard = new RateLimitGuard(
        svc,
        makeJwt({ 'tok-a': 'user-a', 'tok-b': 'user-b' }),
      );

      // global.user is 300/60s — spend user-a's entire budget.
      for (let i = 0; i < 300; i++) {
        await guard.canActivate(ctx(authed('tok-a')));
      }

      await expect(guard.canActivate(ctx(authed('tok-a')))).rejects.toThrow(
        HttpException,
      );

      // user-b shares the IP but must be untouched.
      await expect(guard.canActivate(ctx(authed('tok-b')))).resolves.toBe(true);
    });

    it('does not let an unverifiable token borrow another user’s budget', async () => {
      const svc = makeService();
      const guard = new RateLimitGuard(svc, makeJwt({ 'tok-a': 'user-a' }));

      // A forged token resolves to null and is treated as anonymous, keyed by
      // IP — it can neither mint a fresh user bucket nor spend user-a's.
      const forged = authed('forged-token', '198.51.100.1');
      await guard.canActivate(ctx(forged));

      const d = await svc.consume('global.user', 'user-a');
      expect(d.remaining).toBe(299);
    });

    it('honours request.user when something has already authenticated', async () => {
      const svc = makeService();
      const guard = new RateLimitGuard(svc, undefined);

      await guard.canActivate(
        ctx({
          ip: '203.0.113.7',
          path: '/x',
          user: { id: 'preset-user' },
          headers: {},
        }),
      );

      expect((await svc.consume('global.user', 'preset-user')).remaining).toBe(
        298,
      );
    });
  });

  describe('anonymous traffic', () => {
    it('applies the IP tier only when there is no verified user', async () => {
      const svc = makeService();
      const guard = new RateLimitGuard(svc, makeJwt({}));
      const anon = {
        ip: '198.51.100.9',
        path: '/api/support/help',
        headers: {},
      };

      await guard.canActivate(ctx(anon));

      expect((await svc.consume('global.ip', '198.51.100.9')).remaining).toBe(
        118,
      );
    });

    /**
     * Campus NAT: thousands of students share one address. Applying the IP tier
     * to authenticated traffic as well would take a whole campus down at peak,
     * so a verified request must not touch the IP budget at all.
     */
    it('does not charge the IP budget for an authenticated request', async () => {
      const svc = makeService();
      const guard = new RateLimitGuard(svc, makeJwt({ 'tok-a': 'user-a' }));

      for (let i = 0; i < 50; i++) {
        await guard.canActivate(ctx(authed('tok-a', '10.0.0.1')));
      }

      // Untouched: full 120 budget minus this probe.
      expect((await svc.consume('global.ip', '10.0.0.1')).remaining).toBe(119);
    });
  });

  describe('admin traffic', () => {
    /**
     * Admin sessions are signed with ADMIN_JWT_ACCESS_SECRET, not by Supabase,
     * and usually arrive in an `admin_access` cookie rather than an
     * Authorization header. Resolving only Supabase tokens dropped every admin
     * into the anonymous per-IP tier, so a whole office shared one 120/min
     * budget while loading dashboards.
     */
    const secret = config.auth.admin.accessSecret;
    const adminToken = (sub: string) =>
      secret ? jwt.sign({ sub, sessionId: 's1' }, secret) : null;

    it('counts an admin per account, not per IP', async () => {
      const token = adminToken('admin-1');
      if (!token) return; // no admin secret configured in this environment

      const svc = makeService();
      const guard = new RateLimitGuard(svc, makeJwt({}));

      for (let i = 0; i < 40; i++) {
        await guard.canActivate(
          ctx({
            ip: '10.0.0.7',
            path: '/admin/dashboard/stats',
            headers: {},
            cookies: { admin_access: token },
          }),
        );
      }

      // The shared IP tier must be untouched...
      expect((await svc.consume('global.ip', '10.0.0.7')).remaining).toBe(119);
      // ...and the admin's own budget is what was spent.
      expect(
        (await svc.consume('global.user', 'admin:admin-1')).remaining,
      ).toBe(259);
    });

    it('keeps two admins on the same IP independent', async () => {
      const a = adminToken('admin-a');
      const b = adminToken('admin-b');
      if (!a || !b) return;

      const svc = makeService();
      const guard = new RateLimitGuard(svc, makeJwt({}));

      const req = (t: string) => ({
        ip: '10.0.0.8',
        path: '/admin/users',
        headers: {},
        cookies: { admin_access: t },
      });

      for (let i = 0; i < 300; i++) await guard.canActivate(ctx(req(a)));

      await expect(guard.canActivate(ctx(req(a)))).rejects.toThrow(
        HttpException,
      );
      await expect(guard.canActivate(ctx(req(b)))).resolves.toBe(true);
    });

    it('ignores an admin cookie with a forged signature', async () => {
      const svc = makeService();
      const guard = new RateLimitGuard(svc, makeJwt({}));

      const forged = jwt.sign({ sub: 'admin-evil' }, 'not-the-real-secret');
      await guard.canActivate(
        ctx({
          ip: '10.0.0.9',
          path: '/admin/users',
          headers: {},
          cookies: { admin_access: forged },
        }),
      );

      // Treated as anonymous — it must not mint an admin bucket.
      expect((await svc.consume('global.ip', '10.0.0.9')).remaining).toBe(118);
    });
  });

  describe('health probes', () => {
    it('never rate limits liveness checks', async () => {
      const guard = new RateLimitGuard(makeService(), makeJwt({}));

      for (let i = 0; i < 500; i++) {
        await expect(
          guard.canActivate(
            ctx({ ip: '10.0.0.5', path: '/health', headers: {} }),
          ),
        ).resolves.toBe(true);
      }
    });
  });

  describe('429 response', () => {
    it('carries a stable code, a retry hint and RateLimit headers', async () => {
      const svc = makeService();
      const guard = new RateLimitGuard(svc, makeJwt({ 'tok-a': 'user-a' }));

      for (let i = 0; i < 300; i++) {
        await guard.canActivate(ctx(authed('tok-a')));
      }

      const context = ctx(authed('tok-a'));
      const response: any = context.switchToHttp().getResponse();

      try {
        await guard.canActivate(context);
        throw new Error('expected a 429');
      } catch (e) {
        const err = e as HttpException;
        expect(err.getStatus()).toBe(429);

        const body = err.getResponse() as any;
        expect(body.code).toBe('rate_limited');
        expect(body.retryAfterSeconds).toBeGreaterThan(0);

        expect(response.headers['Retry-After']).toBeDefined();
        expect(response.headers['RateLimit']).toContain('limit=300');
      }
    });
  });
});
