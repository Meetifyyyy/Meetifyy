import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../../common/testing/pagination-app';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

describe('AdminUsersController body validation', () => {
  let app: INestApplication<Server>;
  const setCampusRep = jest.fn((..._args: unknown[]) => Promise.resolve({}));
  const suspendUser = jest.fn((..._args: unknown[]) => Promise.resolve({}));

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: AdminUsersController,
      guards: [AdminJwtGuard],
      validate: true,
      providers: [
        {
          provide: AdminUsersService,
          useValue: { setCampusRep, suspendUser },
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('POST /admin/users/:id/campus-rep', () => {
    const post = (body: unknown) =>
      request(app.getHttpServer())
        .post('/admin/users/u1/campus-rep')
        .send(body as object);

    it.each([true, false])('passes %s through', async (isCampusRep) => {
      await post({ isCampusRep }).expect(201);
      expect(setCampusRep).toHaveBeenCalledWith('u1', isCampusRep);
    });

    it.each([
      ['a string', { isCampusRep: 'true' }],
      ['a number', { isCampusRep: 1 }],
      ['null', { isCampusRep: null }],
      ['a missing field', {}],
      ['an undeclared field', { isCampusRep: true, a: 1 }],
    ])(
      'refuses %s, which used to be coerced by Boolean()',
      async (_l, body) => {
        await post(body).expect(400);
        expect(setCampusRep).not.toHaveBeenCalled();
      },
    );
  });

  describe('POST /admin/users/:id/suspend', () => {
    it('accepts the bodyless request the portal sends', async () => {
      await request(app.getHttpServer())
        .post('/admin/users/u1/suspend')
        .expect(201);
      expect(suspendUser).toHaveBeenCalledWith('u1', undefined);
    });

    it('passes a reason through', async () => {
      await request(app.getHttpServer())
        .post('/admin/users/u1/suspend')
        .send({ reason: 'spam' })
        .expect(201);
      expect(suspendUser).toHaveBeenCalledWith('u1', 'spam');
    });

    it.each([
      ['a reason over 500 characters', { reason: 'r'.repeat(501) }],
      ['a numeric reason', { reason: 5 }],
      ['an array reason', { reason: ['a'] }],
      ['an undeclared field', { reason: 'x', a: 1 }],
    ])('refuses %s', async (_l, body) => {
      await request(app.getHttpServer())
        .post('/admin/users/u1/suspend')
        .send(body)
        .expect(400);
      expect(suspendUser).not.toHaveBeenCalled();
    });
  });
});
