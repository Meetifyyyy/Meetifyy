import type { Server } from 'http';
import { INestApplication, ExecutionContext } from '@nestjs/common';
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
  let app: INestApplication<Server>;
  const service = {
    listRequests: jest.fn(() => Promise.resolve({ total: 0, requests: [] })),
    updateStatus: jest.fn(() => Promise.resolve({ request: {}, user: {} })),
    getDocumentUrls: jest.fn(() =>
      Promise.resolve({
        selfie: { url: null, signError: false },
        idCard: { url: null, signError: false },
      }),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminVerificationController],
      providers: [{ provide: AdminVerificationService, useValue: service }],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ admin?: { id: string } }>().admin = {
            id: 'super-admin-7',
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
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

  it('serves fresh document URLs for one request, behind the same guard', async () => {
    await request(app.getHttpServer())
      .get('/admin/verification/requests/req-1/documents')
      .expect(200);
    expect(service.getDocumentUrls).toHaveBeenCalledWith('req-1');
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

  it('clamps a huge limit and offset before they reach the service', async () => {
    service.listRequests.mockClear();
    await request(app.getHttpServer())
      .get('/admin/verification/requests?limit=100000&offset=99999999')
      .expect(200);
    expect(service.listRequests).toHaveBeenCalledWith(undefined, 100, 10000);
  });

  it('keeps the queue defaults of 20 and 0 for junk', async () => {
    service.listRequests.mockClear();
    await request(app.getHttpServer())
      .get('/admin/verification/requests?limit=abc&offset=-5')
      .expect(200);
    expect(service.listRequests).toHaveBeenCalledWith(undefined, 20, 0);
  });

  it('no longer answers on the api/-prefixed path', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/verification/requests')
      .expect(404);
  });
});
