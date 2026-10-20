import type { Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { UploadsController } from './uploads.controller';
import { StorageService } from './uploads.service';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import type { StorageProvider } from './providers/storage-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../common/testing/stub';

/**
 * Support attachments are anonymous, user-supplied files. They must never be
 * served unauthenticated, and a presigned upload must not let the client pick
 * the stored extension.
 */
describe('support attachments are private', () => {
  const service = new StorageService(
    stub<StorageProvider>(),
    stub<PrismaService>(),
    stub<ConfigService>({ get: jest.fn(() => undefined) }),
  );

  it('treats support/ keys as always private', () => {
    expect(service.isAlwaysPrivateKey('support/abc.png')).toBe(true);
    expect(service.visibilityForFolder('support')).toBe('private');
  });

  it('answers a public GET for a support key with a 404 and no redirect or file', async () => {
    const headers: Record<string, string> = {};
    const res = stub<Response>({
      setHeader: jest.fn((k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      }),
      removeHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      redirect: jest.fn(() => {
        throw new Error('must not redirect');
      }),
      sendFile: jest.fn(() => {
        throw new Error('must not serve from disk');
      }),
    });
    const controller = new UploadsController(service);

    await controller['handleGetMedia'](
      'support/deadbeefdeadbeefdeadbeefdeadbeef.png',
      'support',
      res,
      null,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
    expect(headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('presigned upload key and signature', () => {
  const build = () => {
    const provider = Object.create(
      CloudflareR2Provider.prototype,
    ) as CloudflareR2Provider;
    Object.assign(provider, {
      bucketName: 'media',
      verificationBucketName: 'private',
      isConfigured: true,
      s3: new S3Client({
        region: 'auto',
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
        requestChecksumCalculation: 'WHEN_REQUIRED',
      }),
      publicUrl: 'https://cdn.example',
    });
    return provider;
  };

  it('derives the extension from the content type, not the filename', async () => {
    const out = await build().createSignedUploadUrl(
      'evil.html',
      'image/png',
      'posts',
    );
    expect(out.key).toMatch(/^posts\/[0-9a-f-]{36}\.png$/);
  });

  it('never produces an html extension even for a hostile filename', async () => {
    const out = await build().createSignedUploadUrl(
      'x.svg.html',
      'video/mp4',
      'posts',
    );
    expect(out.key.endsWith('.mp4')).toBe(true);
  });

  it('signs the Content-Type so storage rejects a different one', async () => {
    const out = await build().createSignedUploadUrl(
      'a.png',
      'image/png',
      'posts',
    );
    const signedHeaders =
      new URL(out.uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signedHeaders.split(';')).toContain('content-type');
    // The client already sends exactly its declared type; returning it too
    // would make XHR combine it into "image/png, image/png".
    expect(out.headers).not.toHaveProperty('Content-Type');
  });
});
