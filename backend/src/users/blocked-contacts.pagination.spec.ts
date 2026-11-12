import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../common/testing/pagination-app';
import { BlockedContactsController } from './blocked-contacts.controller';
import { UsersService } from './users.service';
import { JwtGuard } from '../common/guards/jwt.guard';

describe('BlockedContactsController pagination', () => {
  let app: INestApplication<Server>;
  const getBlockedContacts = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: BlockedContactsController,
      guards: [JwtGuard],
      providers: [{ provide: UsersService, useValue: { getBlockedContacts } }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => getBlockedContacts.mockClear());

  it('clamps a huge limit and offset before they reach the service', async () => {
    await request(app.getHttpServer())
      .get('/api/settings/blocked-contacts?limit=100000&offset=99999999')
      .expect(200);
    expect(getBlockedContacts.mock.calls[0].slice(1)).toEqual([50, 10000]);
  });

  it('keeps the defaults of 20 and 0 for junk', async () => {
    await request(app.getHttpServer())
      .get('/api/settings/blocked-contacts?limit=abc&offset=-4')
      .expect(200);
    expect(getBlockedContacts.mock.calls[0].slice(1)).toEqual([20, 0]);
  });
});
