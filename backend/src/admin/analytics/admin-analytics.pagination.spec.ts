import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../../common/testing/pagination-app';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

describe('AdminAnalyticsController pagination', () => {
  let app: INestApplication<Server>;
  const getErrorLogs = jest.fn((..._args: unknown[]) => Promise.resolve({}));
  const getSlowRequests = jest.fn((..._args: unknown[]) => Promise.resolve({}));

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: AdminAnalyticsController,
      guards: [AdminJwtGuard],
      providers: [
        {
          provide: AdminAnalyticsService,
          useValue: { getErrorLogs, getSlowRequests },
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const firstArg = (
    fn: jest.Mock<Promise<object>, unknown[]>,
  ): { page?: number; limit?: number } =>
    fn.mock.calls[0][0] as { page?: number; limit?: number };

  it.each([
    ['/admin/analytics/error-logs', getErrorLogs, 25],
    ['/admin/analytics/slow-requests', getSlowRequests, 25],
  ])('bounds page and limit on %s', async (url, fn, defaultLimit) => {
    await request(app.getHttpServer())
      .get(`${url}?page=99999999&limit=100000`)
      .expect(200);
    expect(firstArg(fn)).toMatchObject({ page: 1000, limit: 100 });

    fn.mockClear();
    await request(app.getHttpServer())
      .get(`${url}?page=abc&limit=-2`)
      .expect(200);
    expect(firstArg(fn)).toMatchObject({ page: 1, limit: defaultLimit });
  });
});
