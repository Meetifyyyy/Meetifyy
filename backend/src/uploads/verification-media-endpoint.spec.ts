import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UploadsController } from './uploads.controller';
import { StorageService } from './uploads.service';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * `GET /api/media/*` end-to-end. This is the endpoint that was serving identity
 * documents to anyone holding the key, so the assertion has to be made against
 * the real route, not just the service beneath it.
 */
describe('GET /api/media — verification documents', () => {
  let app: INestApplication;

  const storage = {
    isSafeStorageKey: jest.fn(() => true),
    isAlwaysPrivateKey: jest.fn((key: string) => key.startsWith('verification/')),
    exists: jest.fn(async () => true),
    getResolvedPublicUrl: jest.fn(async (key: string) =>
      key.startsWith('verification/') ? null : `https://cdn.example/${key}`,
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        { provide: StorageService, useValue: storage },
        // The GET routes under test carry no JwtGuard; it is only needed so
        // the controller's other (guarded) routes can be instantiated.
        { provide: SupabaseService, useValue: { isConfigured: false } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('refuses a verification document to an unauthenticated caller', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/media/verification/deadbeef.jpg')
      .expect(404);

    // Indistinguishable from a missing object: the response must not confirm
    // that a particular person's ID card exists.
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toBe('');
  });

  it('does not even attempt to resolve a verification key', async () => {
    storage.getResolvedPublicUrl.mockClear();
    await request(app.getHttpServer())
      .get('/api/media/verification/deadbeef.jpg')
      .expect(404);
    // Short-circuited before resolution — and, importantly, before the
    // local-disk branch that would have streamed the file directly.
    expect(storage.getResolvedPublicUrl).not.toHaveBeenCalled();
  });

  it('still redirects ordinary public media', async () => {
    await request(app.getHttpServer())
      .get('/api/media/posts/cat.jpg')
      .expect(302)
      .expect('location', 'https://cdn.example/posts/cat.jpg');
  });
});
