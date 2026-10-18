// sanitize-html is ESM-only under ts-jest; the controller spec never sanitizes.
jest.mock('../../common/utils/sanitize-html.util', () => ({
  sanitizeArticleHtml: (html: string) => html,
  htmlToPlainText: (html: string) => html,
}));

import type { Server } from 'http';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminLegalController } from './admin-legal.controller';
import { AdminLegalService } from './admin-legal.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { stub } from '../../common/testing/stub';

/** The service double. Member names are checked against the real class. */
const makeService = () => ({
  listDocuments: jest.fn(() => Promise.resolve([])),
  countActiveUsers: jest.fn(() => Promise.resolve(1030)),
  notify: jest.fn(() => Promise.resolve({ versions: [] })),
  publishDraft: jest.fn(() => Promise.resolve({ id: 'v-3' })),
  startDraft: jest.fn(() => Promise.resolve({ id: 'v-3' })),
});

const VALIDATION = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('AdminLegalController — the real guard', () => {
  let app: INestApplication<Server>;
  const service = makeService();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminLegalController],
      providers: [
        {
          provide: AdminLegalService,
          useValue: stub<AdminLegalService>(service),
        },
        { provide: ConfigService, useValue: stub<ConfigService>({}) },
        { provide: PrismaService, useValue: stub<PrismaService>({}) },
      ],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('refuses a request with no admin session', async () => {
    await request(app.getHttpServer())
      .get('/admin/legal/documents')
      .expect(401);
    await request(app.getHttpServer())
      .post('/admin/legal/notify')
      .send({
        documentTypes: ['TERMS_OF_SERVICE'],
        changeSummary: 'Ten chars!!',
      })
      .expect(401);
    expect(service.listDocuments).not.toHaveBeenCalled();
    expect(service.notify).not.toHaveBeenCalled();
  });

  it('refuses an app user token, which the admin secret cannot verify', async () => {
    await request(app.getHttpServer())
      .post('/admin/legal/documents/TERMS_OF_SERVICE/publish')
      .set('Authorization', 'Bearer not-an-admin-token')
      .send({ notifyUsers: false })
      .expect(401);
    expect(service.publishDraft).not.toHaveBeenCalled();
  });
});

describe('AdminLegalController — routing and validation', () => {
  let app: INestApplication<Server>;
  const service = makeService();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminLegalController],
      providers: [
        {
          provide: AdminLegalService,
          useValue: stub<AdminLegalService>(service),
        },
      ],
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
    app.useGlobalPipes(VALIDATION);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('reports the audience for the confirm step', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/legal/audience')
      .expect(200);
    expect(res.body).toEqual({ totalActiveUsers: 1030 });
  });

  it('attributes a publish to the admin and passes the notify choice', async () => {
    await request(app.getHttpServer())
      .post('/admin/legal/documents/PRIVACY_POLICY/publish')
      .send({ notifyUsers: true, changeSummary: 'We changed retention.' })
      .expect(200);
    expect(service.publishDraft).toHaveBeenCalledWith(
      'PRIVACY_POLICY',
      'super-admin-7',
      expect.objectContaining({ notifyUsers: true }),
    );
  });

  it('rejects a publish that does not choose whether to notify', async () => {
    await request(app.getHttpServer())
      .post('/admin/legal/documents/PRIVACY_POLICY/publish')
      .send({ changeSummary: 'We changed retention.' })
      .expect(400);
    expect(service.publishDraft).not.toHaveBeenCalled();
  });

  it('rejects an unknown document type in the path', async () => {
    await request(app.getHttpServer())
      .post('/admin/legal/documents/NOT_A_DOC/publish')
      .send({ notifyUsers: false })
      .expect(400);
  });

  it('rejects a notify with duplicate types', async () => {
    await request(app.getHttpServer())
      .post('/admin/legal/notify')
      .send({
        documentTypes: ['TERMS_OF_SERVICE', 'TERMS_OF_SERVICE'],
        changeSummary: 'Ten chars!!',
      })
      .expect(400);
    expect(service.notify).not.toHaveBeenCalled();
  });

  it('passes a restore-as-draft request through', async () => {
    const id = '0b6f3c1e-8a4d-4f7a-9c2b-3e5d6f7a8b9c';
    await request(app.getHttpServer())
      .post('/admin/legal/documents/TERMS_OF_SERVICE/draft')
      .send({ fromVersionId: id })
      .expect(200);
    expect(service.startDraft).toHaveBeenCalledWith(
      'TERMS_OF_SERVICE',
      'super-admin-7',
      id,
    );
  });
});
