import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { JwtGuard } from '../common/guards/jwt.guard';

/**
 * The verification controller was mounted at `/verification` while the client
 * has always posted to `/api/verification/request`, and the app sets no global
 * prefix. Every submission 404'd, so no account could reach PENDING — let alone
 * VERIFIED — through the product at all. The happy path *looked* fine in the UI
 * because the panel reported a generic failure.
 *
 * This pins the mounted path against the path the client calls, so the two
 * cannot drift apart again without a test failing.
 */
describe('VerificationController — routing', () => {
  let app: INestApplication;
  const service = {
    submitVerification: jest.fn(async () => ({ id: 'req-1' })),
    getStatus: jest.fn(async () => ({ status: 'UNVERIFIED', request: null })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [VerificationController],
      providers: [{ provide: VerificationService, useValue: service }],
    })
      // The guard is not under test; it is replaced so the routing assertion
      // is about the path and nothing else.
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { id: 'user-1' };
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

  it('serves submission at the path the client posts to', async () => {
    await request(app.getHttpServer())
      .post('/api/verification/request')
      .send({ selfieMediaId: 'm1', idCardMediaId: 'm2' })
      .expect(201);
    expect(service.submitVerification).toHaveBeenCalledWith('user-1', 'm1', 'm2');
  });

  it('serves status under the same api/ prefix', async () => {
    await request(app.getHttpServer())
      .get('/api/verification/status')
      .expect(200);
  });

  it('no longer answers on the unprefixed path', async () => {
    await request(app.getHttpServer())
      .post('/verification/request')
      .send({ selfieMediaId: 'm1', idCardMediaId: 'm2' })
      .expect(404);
  });
});
