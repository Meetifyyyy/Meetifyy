import type { ConfigService } from '@nestjs/config';
import { StorageService } from './uploads.service';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from './providers/storage-provider.interface';

type MediaRow = {
  objectKey: string;
  ownerId: string | null;
  visibility: string;
  provider: string;
  bucket: string;
};

/**
 * Who may be handed a signed link to a private object.
 *
 * Identity documents are the sharp case: the verification code promises the
 * user no document URL, and a signed link is a bearer credential that stays
 * valid for up to an hour wherever it is copied. Only a reviewer, through
 * getReviewerSignedUrl behind the admin guard, reads them.
 */
describe('signed URLs', () => {
  const OWNER = 'user-1';
  const VERIFICATION_KEY = `verification/live-id-${'a'.repeat(32)}.jpg`;
  const PRIVATE_KEY = 'avatars/private-photo.jpg';

  let rows: MediaRow[];
  let signRequests: string[][];
  let service: StorageService;

  const row = (objectKey: string, over: Partial<MediaRow> = {}): MediaRow => ({
    objectKey,
    ownerId: OWNER,
    visibility: 'private',
    provider: 'r2',
    bucket: 'b',
    ...over,
  });

  beforeEach(() => {
    rows = [];
    signRequests = [];
    service = new StorageService(
      stub<StorageProvider>({
        createSignedUrls: jest.fn((keys: string[]) => {
          signRequests.push(keys);
          return Promise.resolve(
            Object.fromEntries(keys.map((k) => [k, `signed://${k}`])),
          );
        }),
        getPublicUrl: (k: string) => `https://cdn.example/${k}`,
      }),
      stub<PrismaService>({
        media: {
          findMany: jest.fn(() => Promise.resolve(rows)),
        },
      }),
      stub<ConfigService>({ get: jest.fn(() => undefined) }),
    );
  });

  describe('for the owner', () => {
    it('refuses to sign the owner their own verification document', async () => {
      rows = [row(VERIFICATION_KEY)];
      const result = await service.getSignedUrlsForUser(
        [VERIFICATION_KEY],
        3600,
        OWNER,
      );
      expect(result).toEqual({});
      expect(signRequests).toHaveLength(0);
    });

    it('does not fall back to a public URL for a verification key with no row', async () => {
      // An unregistered, non-thumbnail key otherwise takes the public-URL
      // shortcut, which is a path into the folder the media route refuses.
      rows = [];
      const result = await service.getSignedUrlsForUser(
        ['verification/orphan.jpg'],
        3600,
        OWNER,
      );
      expect(result).toEqual({});
    });

    it('refuses it even when the row wrongly says public', async () => {
      rows = [row(VERIFICATION_KEY, { visibility: 'public' })];
      const result = await service.getSignedUrlsForUser(
        [VERIFICATION_KEY],
        3600,
        OWNER,
      );
      expect(result).toEqual({});
    });

    it('still signs an ordinary private item alongside it', async () => {
      rows = [row(VERIFICATION_KEY), row(PRIVATE_KEY)];
      const result = await service.getSignedUrlsForUser(
        [VERIFICATION_KEY, PRIVATE_KEY],
        3600,
        OWNER,
      );
      expect(result).toEqual({ [PRIVATE_KEY]: `signed://${PRIVATE_KEY}` });
      expect(signRequests).toEqual([[PRIVATE_KEY]]);
    });

    it("does not sign someone else's private item", async () => {
      rows = [row(PRIVATE_KEY, { ownerId: 'someone-else' })];
      const result = await service.getSignedUrlsForUser(
        [PRIVATE_KEY],
        3600,
        OWNER,
      );
      expect(result).toEqual({});
    });
  });

  describe('for a reviewer', () => {
    it('still signs a verification document, with the short lifetime it asks for', async () => {
      const url = await service.getReviewerSignedUrl(VERIFICATION_KEY, 300);
      expect(url).toBe(`signed://${VERIFICATION_KEY}`);
      expect(signRequests).toEqual([[VERIFICATION_KEY]]);
    });

    it('does not let the owner read the reviewer URL back through the shared cache', async () => {
      // The reviewer's signature is cached by key. The owner path must not even
      // reach that cache for a verification key.
      rows = [row(VERIFICATION_KEY)];
      await service.getReviewerSignedUrl(VERIFICATION_KEY, 300);
      const result = await service.getSignedUrlsForUser(
        [VERIFICATION_KEY],
        3600,
        OWNER,
      );
      expect(result).toEqual({});
    });
  });

  describe('the signed URL cache', () => {
    const cacheOf = () => service['signedUrlCache'];

    afterEach(() => jest.restoreAllMocks());

    it('never holds more entries than its cap', async () => {
      const cap = StorageService['SIGNED_URL_CACHE_MAX_ENTRIES'];
      const keys = Array.from(
        { length: cap + 250 },
        (_, i) => `posts/k${i}.jpg`,
      );
      // In batches of 100, as the route allows.
      for (let i = 0; i < keys.length; i += 100) {
        await service.getSignedUrls(keys.slice(i, i + 100), 3600);
        expect(cacheOf().size).toBeLessThanOrEqual(cap);
      }
      expect(cacheOf().size).toBe(cap);
    });

    it('serves a repeat from the cache and re-signs once it is near expiry', async () => {
      const start = Date.now();
      const now = jest.spyOn(Date, 'now').mockReturnValue(start);

      await service.getSignedUrls([PRIVATE_KEY], 3600);
      await service.getSignedUrls([PRIVATE_KEY], 3600);
      expect(signRequests).toHaveLength(1);

      // Inside the last minute of its life it is not handed out again.
      now.mockReturnValue(start + (3600 - 60) * 1000 - 1000);
      await service.getSignedUrls([PRIVATE_KEY], 3600);
      expect(signRequests).toHaveLength(2);
    });

    it('drops expired entries when it next writes, so the cap holds only live ones', async () => {
      const start = Date.now();
      const now = jest.spyOn(Date, 'now').mockReturnValue(start);
      await service.getSignedUrls(['posts/a.jpg', 'posts/b.jpg'], 3600);
      expect(cacheOf().size).toBe(2);

      now.mockReturnValue(start + 3600 * 1000 + 1);
      await service.getSignedUrls(['posts/c.jpg'], 3600);
      expect(cacheOf().size).toBe(1);
    });
  });
});
