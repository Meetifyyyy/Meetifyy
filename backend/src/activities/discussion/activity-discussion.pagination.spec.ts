import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../../common/testing/pagination-app';
import { ActivityDiscussionController } from './activity-discussion.controller';
import { ActivityDiscussionService } from './activity-discussion.service';
import { JwtGuard } from '../../common/guards/jwt.guard';

describe('ActivityDiscussionController pagination', () => {
  let app: INestApplication<Server>;
  const getMessages = jest.fn((..._args: unknown[]) => Promise.resolve({}));

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: ActivityDiscussionController,
      guards: [JwtGuard],
      providers: [
        { provide: ActivityDiscussionService, useValue: { getMessages } },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => getMessages.mockClear());

  it('clamps a huge limit before it reaches the service', async () => {
    await request(app.getHttpServer())
      .get('/api/activities/a1/discussion?limit=100000')
      .expect(200);
    expect(getMessages.mock.calls[0][3]).toBe(50);
  });

  it('keeps the default of 20 for a missing limit', async () => {
    await request(app.getHttpServer())
      .get('/api/activities/a1/discussion')
      .expect(200);
    expect(getMessages.mock.calls[0][3]).toBe(20);
  });
});
