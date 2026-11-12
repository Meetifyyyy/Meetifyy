import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { createPaginationApp } from '../common/testing/pagination-app';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { MAX_INVITEES_PER_REQUEST } from './dto/invite-friends.dto';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import { RATE_LIMIT_POLICIES_KEY } from '../common/rate-limit/rate-limit.decorator';
import { RATE_LIMIT_POLICIES } from '../config/rate-limit.config';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uuids = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => uuid(i + 1));

/**
 * A named-field `@Body('userIds')` skips class-validator entirely, so the array
 * was bounded only by the 100 KB body limit. These run the real global pipe.
 */
describe('ActivitiesController body validation', () => {
  let app: INestApplication<Server>;
  const inviteFriends = jest.fn((..._args: unknown[]) =>
    Promise.resolve({ results: [] }),
  );
  const updateActivityVisibility = jest.fn((..._args: unknown[]) =>
    Promise.resolve({ success: true }),
  );

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: ActivitiesController,
      guards: [JwtGuard, RateLimitPolicyGuard],
      validate: true,
      providers: [
        {
          provide: ActivitiesService,
          useValue: { inviteFriends, updateActivityVisibility },
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/activities/:id/invite', () => {
    const invite = (body: unknown) =>
      request(app.getHttpServer())
        .post('/api/activities/a1/invite')
        .send(body as object);

    it('passes the ids the client sends to the service', async () => {
      await invite({ userIds: [uuid(1), uuid(2)] }).expect(201);
      expect(inviteFriends).toHaveBeenCalledWith('a1', 'user-1', [
        uuid(1),
        uuid(2),
      ]);
    });

    it('accepts an empty selection, as the service always has', async () => {
      await invite({ userIds: [] }).expect(201);
    });

    it('accepts exactly the cap and refuses one more', async () => {
      await invite({ userIds: uuids(MAX_INVITEES_PER_REQUEST) }).expect(201);
      await invite({ userIds: uuids(MAX_INVITEES_PER_REQUEST + 1) }).expect(
        400,
      );
      expect(inviteFriends).toHaveBeenCalledTimes(1);
    });

    it('refuses an oversized array of the size a 100 KB body allows', async () => {
      await invite({ userIds: uuids(2500) }).expect(400);
      expect(inviteFriends).not.toHaveBeenCalled();
    });

    it.each([
      ['a string instead of an array', { userIds: uuid(1) }],
      ['an object instead of an array', { userIds: { id: uuid(1) } }],
      ['a missing field', {}],
      ['ids that are not UUIDs', { userIds: ['not-an-id'] }],
      ['numbers as ids', { userIds: [1, 2] }],
      ['nested arrays', { userIds: [[uuid(1)]] }],
      ['an undeclared field', { userIds: [uuid(1)], extra: true }],
    ])('refuses %s', async (_label, body) => {
      await invite(body).expect(400);
      expect(inviteFriends).not.toHaveBeenCalled();
    });

    it('says why an oversized request was refused', async () => {
      const res = await invite({
        userIds: uuids(MAX_INVITEES_PER_REQUEST + 1),
      });
      expect(JSON.stringify(res.body)).toContain(
        `at most ${MAX_INVITEES_PER_REQUEST} people`,
      );
    });
  });

  describe('PATCH /api/activities/:id/visibility', () => {
    const setVisibility = (body: unknown) =>
      request(app.getHttpServer())
        .patch('/api/activities/a1/visibility')
        .send(body as object);

    it.each(['PUBLIC', 'COLLEGE_ONLY', 'PRIVATE'])('accepts %s', async (v) => {
      await setVisibility({ visibility: v }).expect(200);
      expect(updateActivityVisibility).toHaveBeenCalledWith('a1', 'user-1', v);
    });

    it.each([
      ['an unknown value', { visibility: 'SECRET' }],
      ['a number', { visibility: 1 }],
      ['an array', { visibility: ['PUBLIC'] }],
      ['a missing field', {}],
      ['an undeclared field', { visibility: 'PUBLIC', extra: 1 }],
    ])('refuses %s', async (_label, body) => {
      await setVisibility(body).expect(400);
      expect(updateActivityVisibility).not.toHaveBeenCalled();
    });
  });

  describe('invite rate limit', () => {
    const reflector = new Reflector();
    const handler = ActivitiesController.prototype.inviteFriends;

    it('declares its policy and mounts the policy guard on the handler', () => {
      expect(reflector.get(RATE_LIMIT_POLICIES_KEY, handler)).toEqual([
        'activity.invite.user',
      ]);
      expect(Reflect.getMetadata('__guards__', handler)).toContain(
        RateLimitPolicyGuard,
      );
    });

    it('runs after the class-level authentication guard', () => {
      // A user-keyed policy reads the identity JwtGuard attaches.
      expect(Reflect.getMetadata('__guards__', ActivitiesController)).toContain(
        JwtGuard,
      );
      expect(RATE_LIMIT_POLICIES['activity.invite.user'].dimension).toBe(
        'user',
      );
    });

    it('fails closed when Redis is down: this is a notification fan-out', () => {
      expect(RATE_LIMIT_POLICIES['activity.invite.user'].onRedisFailure).toBe(
        'closed',
      );
    });
  });
});
