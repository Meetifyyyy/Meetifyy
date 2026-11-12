import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../../common/testing/pagination-app';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

describe('AdminUsersController pagination', () => {
  let app: INestApplication<Server>;
  const listUsers = jest.fn((..._args: unknown[]) => Promise.resolve({}));

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: AdminUsersController,
      guards: [AdminJwtGuard],
      providers: [{ provide: AdminUsersService, useValue: { listUsers } }],
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

  it.each([['/admin/users', listUsers, 20]])(
    'bounds page and limit on %s',
    async (url, fn, defaultLimit) => {
      await request(app.getHttpServer())
        .get(`${url}?page=99999999&limit=100000`)
        .expect(200);
      expect(firstArg(fn)).toMatchObject({ page: 1000, limit: 100 });

      fn.mockClear();
      await request(app.getHttpServer())
        .get(`${url}?page=abc&limit=-2`)
        .expect(200);
      expect(firstArg(fn)).toMatchObject({ page: 1, limit: defaultLimit });
    },
  );
});
