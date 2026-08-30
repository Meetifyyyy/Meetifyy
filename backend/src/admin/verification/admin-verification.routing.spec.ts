import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminVerificationController } from './admin-verification.controller';
import { AdminVerificationService } from './admin-verification.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

/**
 * The review endpoint was mounted at `api/admin/verification` while every other
 * admin controller — and the admin client — uses `admin/…`. The review screen
 * therefore 404'd, which is why no verification request was ever decided
 * through it. Pinned here against the path the client actually calls.
 */
describe('AdminVerificationController — routing', () => {
  let app: INestApplication;
  const service = {
    listRequests: jest.fn(async () => ({ total: 0, requests: [] })),
    updateStatus: jest.fn(async () => ({ request: {}, user: {} })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminVerificationController],
      providers: [{ provide: AdminVerificationService, useValue: service }],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().admin = { id: 'super-admin-7' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the queue at the path the admin client requests', async () => {
    await request(app.getHttpServer())
      .get('/admin/verification/requests')
      .expect(200);
  });

  it('serves the decision endpoint there too, and attributes it', async () => {
    await request(app.getHttpServer())
      .patch('/admin/verification/requests/req-1/status')
      .send({ status: 'VERIFIED' })
      .expect(200);
    expect(service.updateStatus).toHaveBeenCalledWith(
      'req-1',
      'VERIFIED',
      undefined,
      'super-admin-7',
    );
  });

  it('no longer answers on the api/-prefixed path', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/verification/requests')
      .expect(404);
  });
});
