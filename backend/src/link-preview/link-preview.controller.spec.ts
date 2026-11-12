import { Reflector } from '@nestjs/core';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { RATE_LIMIT_POLICIES_KEY } from '../common/rate-limit/rate-limit.decorator';
import { RATE_LIMIT_POLICIES } from '../config/rate-limit.config';
import { LinkPreviewController } from './link-preview.controller';

/**
 * The route makes the server fetch a caller-chosen URL. `@RateLimit` alone is
 * only metadata; the policy guard is what enforces it.
 */
describe('LinkPreviewController — rate limit', () => {
  const handler = LinkPreviewController.prototype.getPreview;

  it('declares its policy and mounts the policy guard on the handler', () => {
    expect(new Reflector().get(RATE_LIMIT_POLICIES_KEY, handler)).toEqual([
      'link-preview.user',
    ]);
    expect(Reflect.getMetadata('__guards__', handler)).toContain(
      RateLimitPolicyGuard,
    );
  });

  it('runs after the class-level authentication guard its user key needs', () => {
    expect(Reflect.getMetadata('__guards__', LinkPreviewController)).toContain(
      JwtGuard,
    );
    expect(RATE_LIMIT_POLICIES['link-preview.user']).toMatchObject({
      points: 60,
      duration: 60,
      dimension: 'user',
    });
  });
});
