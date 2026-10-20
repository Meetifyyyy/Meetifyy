import { ExecutionContext, HttpException } from '@nestjs/common';
import type { HttpArgumentsHost } from '@nestjs/common/interfaces';
import { SupportRateLimitGuard } from './support-ratelimit.guard';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import type { RedisService } from '../../redis/redis.service';
import { stub } from '../testing/stub';

const ctx = (request: object): ExecutionContext =>
  stub<ExecutionContext>({
    switchToHttp: jest.fn(() =>
      stub<HttpArgumentsHost>({
        getRequest: jest.fn(() => request),
        getResponse: jest.fn(() => ({ setHeader: jest.fn() })),
      }),
    ),
  });

const submit = (email: string, ip: string) => ({
  ip,
  headers: {},
  body: { email },
});

describe('SupportRateLimitGuard — per-address budget', () => {
  const build = () =>
    new SupportRateLimitGuard(
      new RateLimitService(stub<RedisService>({ getClient: () => null })),
    );

  it('shares one budget across spellings of the same address', async () => {
    const guard = build();
    // support.request.email is 3/hour. Each variant folds to victim@x.com via
    // normalizeEmail (NFKC, invisible characters, case), and each comes from a
    // different IP so only the per-address budget can stop them.
    const variants = [
      'victim@x.com',
      'VICTIM@x.com',
      'ｖictim@x.com', // fullwidth v
    ];
    for (const [i, email] of variants.entries()) {
      await guard.canActivate(ctx(submit(email, `198.51.100.${i + 1}`)));
    }
    await expect(
      guard.canActivate(ctx(submit('victim@x.com​', '198.51.100.9'))),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('does not let an unrelated address borrow that budget', async () => {
    const guard = build();
    for (let i = 0; i < 3; i++) {
      await guard.canActivate(
        ctx(submit('victim@x.com', `198.51.100.${i + 1}`)),
      );
    }
    await expect(
      guard.canActivate(ctx(submit('someone-else@x.com', '198.51.100.50'))),
    ).resolves.toBe(true);
  });
});
