import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../../common/testing/pagination-app';
import { ActivityDiscussionController } from './activity-discussion.controller';
import { ActivityDiscussionService } from './activity-discussion.service';
import { MAX_DISCUSSION_MESSAGE_LENGTH } from './dto/send-discussion-message.dto';
import { JwtGuard } from '../../common/guards/jwt.guard';

describe('ActivityDiscussionController body validation', () => {
  let app: INestApplication<Server>;
  const sendMessage = jest.fn((..._args: unknown[]) => Promise.resolve({}));

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: ActivityDiscussionController,
      guards: [JwtGuard],
      validate: true,
      providers: [
        { provide: ActivityDiscussionService, useValue: { sendMessage } },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/api/activities/a1/discussion')
      .send(body as object);

  it('passes the text the client sends', async () => {
    await post({ text: 'see you there' }).expect(201);
    expect(sendMessage).toHaveBeenCalledWith('a1', 'user-1', 'see you there');
  });

  it('accepts the longest message and refuses one character more', async () => {
    await post({ text: 'a'.repeat(MAX_DISCUSSION_MESSAGE_LENGTH) }).expect(201);
    await post({ text: 'a'.repeat(MAX_DISCUSSION_MESSAGE_LENGTH + 1) }).expect(
      400,
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a number', { text: 5 }],
    ['an array', { text: ['hi'] }],
    ['an object', { text: { value: 'hi' } }],
    ['a missing field', {}],
    ['an undeclared field', { text: 'hi', extra: 1 }],
  ])('refuses %s', async (_label, body) => {
    await post(body).expect(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
