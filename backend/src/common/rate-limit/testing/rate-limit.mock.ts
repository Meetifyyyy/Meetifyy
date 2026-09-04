import { RateLimitService } from '../rate-limit.service';

/**
 * An always-allow RateLimitService for tests that are not about rate limiting.
 *
 * Mirrors `common/verification/testing/verification-access.mock.ts`: a service
 * that every write path now depends on needs one obvious stand-in, rather than
 * each spec inventing its own shape and drifting from the real interface.
 *
 * Tests that DO exercise limits should use the real service against an isolated
 * key prefix — see rate-limit.service.spec.ts — not this.
 */
export function allowAllRateLimit(): RateLimitService {
  const allow = () => ({
    policy: 'global.user',
    allowed: true,
    remaining: Number.MAX_SAFE_INTEGER,
    resetSeconds: 60,
    limit: Number.MAX_SAFE_INTEGER,
    windowSeconds: 60,
    shadowed: false,
    degraded: false,
  });

  return {
    mode: 'enforce',
    consume: jest.fn(async () => allow()),
    consumeAll: jest.fn(async () => allow()),
    check: jest.fn(async () => allow()),
    penalize: jest.fn(async () => undefined),
    hashIdentifier: jest.fn((v: string) => v),
  } as unknown as RateLimitService;
}

/** Ready-made provider entry for `Test.createTestingModule({ providers: [...] })`. */
export const allowAllRateLimitProvider = () => ({
  provide: RateLimitService,
  useValue: allowAllRateLimit(),
});
