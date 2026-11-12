import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../common/testing/pagination-app';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { JwtGuard } from '../common/guards/jwt.guard';

describe('NotificationsController pagination', () => {
  let app: INestApplication<Server>;
  const getNotifications = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: NotificationsController,
      guards: [JwtGuard],
      providers: [
        { provide: NotificationsService, useValue: { getNotifications } },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => getNotifications.mockClear());

  it('clamps a huge limit before it reaches the service', async () => {
    await request(app.getHttpServer())
      .get('/api/notifications?limit=100000')
      .expect(200);
    expect(getNotifications.mock.calls[0][1]).toBe(50);
  });

  it('keeps the default of 20 for junk', async () => {
    await request(app.getHttpServer())
      .get('/api/notifications?limit=abc')
      .expect(200);
    expect(getNotifications.mock.calls[0][1]).toBe(20);
  });
});
