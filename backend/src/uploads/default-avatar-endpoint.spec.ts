import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as fs from 'fs';
import { UploadsController } from './uploads.controller';
import { StorageService } from './uploads.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PrismaService } from '../prisma/prisma.service';
import { bundledDefaultAssetPath, defaultAssetFilePath } from './default-assets.service';
import { DEFAULT_AVATAR_SVG } from './default-avatar';

/**
 * Accounts that never chose a picture carry a real reference to the platform
 * default (`/api/media/defaults/profile-avatar-v2.webp`), so this endpoint is
 * what decides what they look like.
 *
 * In production it decided wrong: resolution of that one key failed and the
 * endpoint fell through to its placeholder SVG, which at the time was grey —
 * so every defaulted account rendered grey while every local test rendered
 * blue. These tests pin both halves of the fix: the default is served from the
 * bundled file regardless of what storage says, and the fallback that covers
 * everything else is the blue artwork.
 */
describe('GET /api/media — default profile avatar', () => {
  let app: INestApplication;

  // Deliberately hostile: storage claims the object does not exist and refuses
  // to resolve it, which is the production failure this endpoint must survive.
  const storage = {
    isSafeStorageKey: jest.fn(() => true),
    isAlwaysPrivateKey: jest.fn(() => false),
    exists: jest.fn(async () => false),
    getResolvedPublicUrl: jest.fn(async () => null),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        { provide: StorageService, useValue: storage },
        { provide: SupabaseService, useValue: { isConfigured: false } },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: async () => null } },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the bundled default avatar even when storage cannot resolve it', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/media/defaults/profile-avatar-v2.webp')
      .expect(200);

    expect(res.headers['content-type']).toContain('image/webp');
    // The real artwork, byte for byte — not a placeholder standing in for it.
    expect(Buffer.compare(res.body, fs.readFileSync(defaultAssetFilePath('profile-avatar')))).toBe(0);
  });

  it('does not depend on storage at all for a bundled default', async () => {
    storage.getResolvedPublicUrl.mockClear();
    storage.exists.mockClear();
    await request(app.getHttpServer())
      .get('/api/media/defaults/profile-avatar-v2.webp')
      .expect(200);
    expect(storage.getResolvedPublicUrl).not.toHaveBeenCalled();
    expect(storage.exists).not.toHaveBeenCalled();
  });

  it('falls back to the blue avatar for an unresolvable avatar key', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/media/avatars/does-not-exist.webp')
      .expect(200);

    expect(res.headers['content-type']).toContain('image/svg+xml');
    const svg = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : res.text;
    expect(svg).toBe(DEFAULT_AVATAR_SVG);
    // The grey placeholder this endpoint used to serve.
    expect(svg).not.toContain('#94a3b8');
    expect(svg).toContain('#1d68f7');
  });

  it('treats only the current version as bundled, leaving older keys to storage', () => {
    expect(bundledDefaultAssetPath('defaults/profile-avatar-v2.webp')).not.toBeNull();
    expect(bundledDefaultAssetPath('defaults/community-avatar-v2.webp')).not.toBeNull();
    // Superseded artwork this build no longer ships still resolves from the
    // bucket, where the object it was uploaded as is retained.
    expect(bundledDefaultAssetPath('defaults/profile-avatar-v1.webp')).toBeNull();
    // A user's own picture can never be mistaken for a platform default.
    expect(bundledDefaultAssetPath('avatars/profile-avatar-v2.webp')).toBeNull();
  });
});
