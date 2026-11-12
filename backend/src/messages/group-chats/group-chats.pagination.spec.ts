import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../../common/testing/pagination-app';
import { GroupChatsController } from './group-chats.controller';
import { GroupChatsService } from './group-chats.service';
import { DomainEventService } from '../../events/domain-event.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationFactory } from '../../notifications/notification.factory';
import { JwtGuard } from '../../common/guards/jwt.guard';

describe('GroupChatsController pagination', () => {
  let app: INestApplication<Server>;
  const getUserGroupConversations = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );
  const getConversationHistory = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: GroupChatsController,
      guards: [JwtGuard],
      providers: [
        {
          provide: GroupChatsService,
          useValue: { getUserGroupConversations, getConversationHistory },
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

  it('clamps the list limit and offset', async () => {
    await request(app.getHttpServer())
      .get('/api/group-chats?limit=100000&offset=99999999')
      .expect(200);
    expect(getUserGroupConversations.mock.calls[0].slice(1)).toEqual([
      50, 10000,
    ]);
  });

  it('clamps the history limit and keeps its default of 10', async () => {
    await request(app.getHttpServer())
      .get('/api/group-chats/c1?limit=100000')
      .expect(200);
    await request(app.getHttpServer()).get('/api/group-chats/c1').expect(200);
    expect(getConversationHistory.mock.calls[0][3]).toBe(50);
    expect(getConversationHistory.mock.calls[1][3]).toBe(10);
  });
});
