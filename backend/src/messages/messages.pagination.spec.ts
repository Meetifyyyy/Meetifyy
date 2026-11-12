import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../common/testing/pagination-app';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { DomainEventService } from '../events/domain-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationFactory } from '../notifications/notification.factory';
import { MEDIA_PAGE_MAX } from './conversation-media.util';
import { JwtGuard } from '../common/guards/jwt.guard';

describe('MessagesController pagination', () => {
  let app: INestApplication<Server>;
  const getUserConversations = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );
  const getConversationHistory = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );
  const getConversationMedia = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: MessagesController,
      guards: [JwtGuard],
      providers: [
        {
          provide: MessagesService,
          useValue: {
            getUserConversations,
            getConversationHistory,
            getConversationMedia,
          },
        },
        { provide: DomainEventService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: NotificationFactory, useValue: {} },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('clamps the inbox limit and offset', async () => {
    await request(app.getHttpServer())
      .get('/api/messages?limit=100000&offset=99999999')
      .expect(200);
    expect(getUserConversations.mock.calls[0].slice(1, 3)).toEqual([50, 10000]);
  });

  it('keeps the inbox defaults of 20 and 0 for junk', async () => {
    await request(app.getHttpServer())
      .get('/api/messages?limit=abc&offset=-1')
      .expect(200);
    expect(getUserConversations.mock.calls[0].slice(1, 3)).toEqual([20, 0]);
  });

  it('clamps the history limit and keeps its default of 50', async () => {
    await request(app.getHttpServer())
      .get('/api/messages/c1?limit=100000')
      .expect(200);
    await request(app.getHttpServer()).get('/api/messages/c1').expect(200);
    expect(getConversationHistory.mock.calls[0][3]).toBe(50);
    expect(getConversationHistory.mock.calls[1][3]).toBe(50);
  });

  it('clamps the media limit to the gallery maximum', async () => {
    await request(app.getHttpServer())
      .get('/api/messages/c1/media?limit=100000')
      .expect(200);
    expect(getConversationMedia.mock.calls[0][3]).toBe(MEDIA_PAGE_MAX);
  });
});
