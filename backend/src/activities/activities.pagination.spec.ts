import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../common/testing/pagination-app';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';

describe('ActivitiesController pagination', () => {
  let app: INestApplication<Server>;
  const getAllActivities = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );
  const getForYouFeed = jest.fn((..._args: unknown[]) => Promise.resolve({}));
  const getSavedActivities = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );
  const getAttendees = jest.fn((..._args: unknown[]) => Promise.resolve({}));

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: ActivitiesController,
      guards: [JwtGuard, RateLimitPolicyGuard],
      providers: [
        {
          provide: ActivitiesService,
          useValue: {
            getAllActivities,
            getForYouFeed,
            getSavedActivities,
            getAttendees,
          },
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('clamps the feed limit, for the plain and the For You feed alike', async () => {
    await request(app.getHttpServer())
      .get('/api/activities?limit=100000')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/activities?scope=for_you&limit=100000')
      .expect(200);
    expect(getAllActivities.mock.calls[0][1]).toBe(50);
    expect(getForYouFeed.mock.calls[0][1]).toBe(50);
  });

  it('keeps the feed default of 20 for junk', async () => {
    await request(app.getHttpServer())
      .get('/api/activities?limit=-3')
      .expect(200);
    expect(getAllActivities.mock.calls[0][1]).toBe(20);
  });

  it('clamps the bookmarks limit', async () => {
    await request(app.getHttpServer())
      .get('/api/activities/bookmarks?limit=100000')
      .expect(200);
    expect(getSavedActivities.mock.calls[0][1]).toBe(50);
  });

  it('clamps the attendees limit and keeps its default of 30', async () => {
    await request(app.getHttpServer())
      .get('/api/activities/a1/attendees?limit=100000')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/activities/a1/attendees')
      .expect(200);
    expect(getAttendees.mock.calls[0][2]).toBe(60);
    expect(getAttendees.mock.calls[1][2]).toBe(30);
  });
});
