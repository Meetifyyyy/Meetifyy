// The controllers pull in services that import sanitize-html (ESM, not
// transformed by this Jest config). This suite only reads route metadata and
// never constructs a controller.
jest.mock('../utils/sanitize-html.util', () => ({
  sanitizeUserHtml: jest.fn((str: string) => str),
  sanitizePlainText: jest.fn((str: string) => str),
  htmlToPlainText: jest.fn((str: string) => str),
}));
jest.mock('../../email/email.service');

import { Reflector } from '@nestjs/core';
import { PostsController } from '../../posts/posts.controller';
import { CommunitiesController } from '../../communities/communities.controller';
import { UploadsController } from '../../uploads/uploads.controller';
import { SupportController } from '../../support/support.controller';
import { JwtGuard } from '../guards/jwt.guard';
import { RateLimitPolicyGuard } from './rate-limit-policy.guard';
import { RATE_LIMIT_POLICIES_KEY } from './rate-limit.decorator';
import { RATE_LIMIT_POLICIES } from '../../config/rate-limit.config';

/**
 * Create-content routes carried no budget of their own, and the support
 * attachment upload shared the 5/hour support-request budget. A route missing
 * its `@RateLimit` is silently unmetered, so the wiring is asserted.
 */
describe('rate-limit wiring on content-creating routes', () => {
  const reflector = new Reflector();

  type Ctor = { prototype: object };
  const handler = (controller: Ctor, method: string) =>
    Reflect.get(controller.prototype, method) as (...a: never[]) => unknown;

  const policiesOn = (controller: Ctor, method: string): string[] =>
    reflector.get(RATE_LIMIT_POLICIES_KEY, handler(controller, method)) ?? [];

  const guardsOn = (controller: Ctor, method: string): unknown[] =>
    (Reflect.getMetadata('__guards__', handler(controller, method)) as
      unknown[] | undefined) ?? [];

  const classGuards = (controller: Ctor): unknown[] =>
    (Reflect.getMetadata('__guards__', controller) as unknown[] | undefined) ??
    [];

  it.each([
    [PostsController, 'createPost', 'content.post.create'],
    [PostsController, 'addComment', 'content.comment.create'],
    [CommunitiesController, 'createCommunity', 'community.create'],
    [UploadsController, 'getPresignedUrl', 'media.presigned'],
    [SupportController, 'uploadAttachment', 'support.attachment.ip'],
  ])(
    '%p.%s declares %s and mounts the policy guard',
    (ctrl, method, policy) => {
      expect(policiesOn(ctrl, method)).toEqual([policy]);
      expect(guardsOn(ctrl, method)).toContain(RateLimitPolicyGuard);
      expect(Object.keys(RATE_LIMIT_POLICIES)).toContain(policy);
    },
  );

  it('user-keyed policies run after an authentication guard', () => {
    // RateLimitPolicyGuard throws on a user-keyed policy with no user, so JwtGuard
    // must have run first: class-level for posts/communities, same list for media.
    expect(classGuards(PostsController)).toContain(JwtGuard);
    expect(classGuards(CommunitiesController)).toContain(JwtGuard);
    const media = guardsOn(UploadsController, 'getPresignedUrl');
    expect(media.indexOf(JwtGuard)).toBeLessThan(
      media.indexOf(RateLimitPolicyGuard),
    );
  });

  it('support attachments no longer share the support-request budget', () => {
    expect(policiesOn(SupportController, 'uploadAttachment')).not.toContain(
      'support.request.ip',
    );
    expect(RATE_LIMIT_POLICIES['support.attachment.ip'].points).toBeGreaterThan(
      RATE_LIMIT_POLICIES['support.request.ip'].points,
    );
  });

  it('has the agreed budgets', () => {
    expect(RATE_LIMIT_POLICIES['content.post.create']).toMatchObject({
      points: 15,
      duration: 600,
      dimension: 'user',
    });
    expect(RATE_LIMIT_POLICIES['content.comment.create']).toMatchObject({
      points: 60,
      duration: 600,
    });
    expect(RATE_LIMIT_POLICIES['community.create']).toMatchObject({
      points: 5,
      duration: 3600,
      onRedisFailure: 'closed',
    });
    expect(RATE_LIMIT_POLICIES['media.presigned']).toMatchObject({
      points: 120,
      duration: 300,
    });
  });
});
