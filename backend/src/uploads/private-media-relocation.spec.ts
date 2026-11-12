import {
  DEFAULT_RELOCATION_CAP,
  isObjectNotFound,
  relocatePrivateMedia,
  type PrivateMediaTarget,
} from './private-media-relocation';
import { cacheControlFor } from './object-cache-control';
import { PRIVATE_PREFIXES } from './private-prefixes';
import { FakeR2, notFoundError } from './testing/fake-r2';

const MAIN = 'meetifyy-media';
const PRIVATE = 'meetifyy-private';

describe('relocatePrivateMedia', () => {
  const setup = () => {
    const r2 = new FakeR2();
    const target: PrivateMediaTarget = {
      s3: r2.client(),
      mainBucket: MAIN,
      privateBucket: PRIVATE,
    };
    return { r2, target };
  };

  it('copies to the private bucket, verifies the copy, then deletes from the main one', async () => {
    const { r2, target } = setup();
    // A space and a plus: both are what URL-encoding the key exists for.
    const key = 'chat/clip 1+2.mp4';
    r2.put(MAIN, key, 'video-bytes', 'video/mp4');
    const moved: string[] = [];

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['chat/'],
      onRelocated: (k) => moved.push(k),
    });

    expect(report.total).toMatchObject({
      scanned: 1,
      copied: 1,
      deleted: 1,
      alreadyPresent: 0,
      failed: 0,
    });
    // The exact order is the safety property.
    expect(
      r2.commands
        .filter((c) => c.key === key)
        .map((c) => `${c.name.replace('Command', '')}:${c.bucket}`),
    ).toEqual([
      `HeadObject:${PRIVATE}`,
      `HeadObject:${MAIN}`,
      `CopyObject:${PRIVATE}`,
      `HeadObject:${PRIVATE}`,
      `DeleteObject:${MAIN}`,
    ]);
    expect(r2.lastCopySource).toBe(`${MAIN}/chat/clip%201%2B2.mp4`);
    expect(r2.has(MAIN, key)).toBe(false);
    // Content type carried over; cache directive as the provider writes it.
    expect(r2.get(PRIVATE, key)).toEqual({
      body: 'video-bytes',
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(moved).toEqual([key]);
  });

  it('gives each moved object the cache directive the provider writes for its key', async () => {
    const { r2, target } = setup();
    for (const prefix of PRIVATE_PREFIXES) r2.put(MAIN, `${prefix}x.bin`, 'b');

    await relocatePrivateMedia(target, { apply: true });

    // Identity documents are never cached; conversation media is cached hard,
    // so a thread's images are not refetched on every view.
    expect(r2.get(PRIVATE, 'verification/x.bin')?.cacheControl).toBe(
      'private, no-store',
    );
    for (const prefix of ['chat/', 'messages/', 'voice/', 'support/']) {
      expect(r2.get(PRIVATE, `${prefix}x.bin`)?.cacheControl).toBe(
        'public, max-age=31536000, immutable',
      );
    }
    for (const prefix of PRIVATE_PREFIXES) {
      expect(r2.get(PRIVATE, `${prefix}x.bin`)?.cacheControl).toBe(
        cacheControlFor(`${prefix}x.bin`),
      );
    }
  });

  it('keeps the original when the copy does not verify', async () => {
    const { r2, target } = setup();
    r2.put(MAIN, 'chat/a.webp', 'bytes', 'image/webp');
    r2.corruptCopy = true;
    const moved: string[] = [];

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['chat/'],
      onRelocated: (k) => moved.push(k),
    });

    expect(report.total).toMatchObject({ copied: 0, deleted: 0, failed: 1 });
    expect(report.errors).toEqual(['CopyVerificationFailed']);
    expect(r2.sent('DeleteObjectCommand')).toHaveLength(0);
    expect(r2.has(MAIN, 'chat/a.webp')).toBe(true);
    expect(moved).toEqual([]);
  });

  it('keeps the original when the copy itself fails', async () => {
    const { r2, target } = setup();
    r2.put(MAIN, 'chat/a.webp', 'bytes');
    r2.copyError = Object.assign(new Error('boom'), { name: 'InternalError' });

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['chat/'],
    });

    expect(report.total).toMatchObject({ failed: 1, deleted: 0 });
    expect(report.errors).toEqual(['InternalError']);
    expect(r2.has(MAIN, 'chat/a.webp')).toBe(true);
  });

  it('only deletes when the private bucket already holds the same size', async () => {
    const { r2, target } = setup();
    r2.put(MAIN, 'voice/a.ogg', 'same-bytes', 'audio/ogg');
    r2.put(PRIVATE, 'voice/a.ogg', 'same-bytes', 'audio/ogg');

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['voice/'],
    });

    expect(report.total).toMatchObject({
      alreadyPresent: 1,
      deleted: 1,
      copied: 0,
    });
    expect(r2.sent('CopyObjectCommand')).toHaveLength(0);
    expect(r2.has(MAIN, 'voice/a.ogg')).toBe(false);
    expect(r2.has(PRIVATE, 'voice/a.ogg')).toBe(true);
  });

  it('copies over a private object of a different size instead of trusting it', async () => {
    const { r2, target } = setup();
    r2.put(MAIN, 'voice/a.ogg', 'the-whole-object');
    r2.put(PRIVATE, 'voice/a.ogg', 'trunc');

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['voice/'],
    });

    expect(report.total).toMatchObject({ copied: 1, deleted: 1 });
    expect(r2.get(PRIVATE, 'voice/a.ogg')?.body).toBe('the-whole-object');
    expect(r2.has(MAIN, 'voice/a.ogg')).toBe(false);
  });

  it('skips a key that vanished before it could be read', async () => {
    const { r2, target } = setup();
    r2.put(MAIN, 'chat/gone.webp', 'bytes');
    // Another process removes it between the listing and the head.
    const send = r2.send.getMockImplementation();
    let listed = false;
    r2.send.mockImplementation((command) => {
      const result = send?.(command) ?? Promise.resolve({});
      if (!listed) {
        listed = true;
        return result.then((page) => {
          r2.buckets.get(MAIN)?.delete('chat/gone.webp');
          return page;
        });
      }
      return result;
    });

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['chat/'],
    });

    expect(report.total).toMatchObject({
      scanned: 1,
      vanished: 1,
      failed: 0,
      copied: 0,
      deleted: 0,
    });
    expect(report.errors).toEqual([]);
  });

  it('treats a copy that finds no source as vanished, not as an error', async () => {
    const { r2, target } = setup();
    r2.put(MAIN, 'chat/a.webp', 'bytes');
    r2.copyError = notFoundError('NoSuchKey');

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['chat/'],
    });

    expect(report.total).toMatchObject({ vanished: 1, failed: 0, deleted: 0 });
    expect(r2.sent('DeleteObjectCommand')).toHaveLength(0);
  });

  it('stops at the cap and says there is more', async () => {
    const { r2, target } = setup();
    for (let i = 0; i < 5; i += 1) r2.put(MAIN, `chat/${i}.webp`, 'b');

    const report = await relocatePrivateMedia(target, {
      apply: true,
      maxObjects: 3,
      prefixes: ['chat/'],
    });

    expect(report.total).toMatchObject({ scanned: 3, copied: 3, deleted: 3 });
    expect(report.capped).toBe(true);
    // The remainder is what the next run picks up.
    expect(r2.buckets.get(MAIN)?.size).toBe(2);
  });

  it('shares one cap across prefixes', async () => {
    const { r2, target } = setup();
    r2.put(MAIN, 'chat/a.webp', 'b');
    r2.put(MAIN, 'voice/a.ogg', 'b');

    const report = await relocatePrivateMedia(target, {
      apply: true,
      maxObjects: 1,
      prefixes: ['chat/', 'voice/'],
    });

    expect(report.byPrefix['chat/'].deleted).toBe(1);
    expect(report.byPrefix['voice/'].scanned).toBe(0);
    expect(report.capped).toBe(true);
  });

  it('is not capped when it finishes within the limit', async () => {
    const { r2, target } = setup();
    r2.put(MAIN, 'chat/a.webp', 'b');
    const report = await relocatePrivateMedia(target, {
      apply: true,
      maxObjects: 3,
      prefixes: ['chat/'],
    });
    expect(report.capped).toBe(false);
  });

  it('pages through a listing larger than one page, deleting as it goes', async () => {
    const { r2, target } = setup();
    for (let i = 0; i < 2300; i += 1) {
      r2.put(MAIN, `chat/${String(i).padStart(5, '0')}.webp`, 'b');
    }

    const report = await relocatePrivateMedia(target, {
      apply: true,
      maxObjects: 5000,
      prefixes: ['chat/'],
    });

    expect(report.total).toMatchObject({ scanned: 2300, deleted: 2300 });
    expect(report.capped).toBe(false);
    expect(r2.buckets.get(MAIN)?.size).toBe(0);
    expect(r2.buckets.get(PRIVATE)?.size).toBe(2300);
  });

  it('visits every private prefix by default and leaves public keys alone', async () => {
    const { r2, target } = setup();
    for (const prefix of PRIVATE_PREFIXES) r2.put(MAIN, `${prefix}x.bin`, 'b');
    r2.put(MAIN, 'posts/x.webp', 'b');

    const report = await relocatePrivateMedia(target, { apply: true });

    expect(Object.keys(report.byPrefix)).toEqual([...PRIVATE_PREFIXES]);
    expect(report.total.deleted).toBe(PRIVATE_PREFIXES.length);
    expect([...(r2.buckets.get(MAIN)?.keys() ?? [])]).toEqual(['posts/x.webp']);
    expect(DEFAULT_RELOCATION_CAP).toBe(2000);
  });

  it('carries on past a key that fails and counts it', async () => {
    const { r2, target } = setup();
    r2.put(MAIN, 'chat/a.webp', 'b');
    r2.put(MAIN, 'chat/b.webp', 'b');
    r2.failDeleteFor = (key) => key === 'chat/a.webp';

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['chat/'],
    });

    expect(report.total).toMatchObject({ scanned: 2, deleted: 1, failed: 1 });
    expect(report.errors).toEqual(['AccessDenied']);
    // The verified copy is still there, so the next run only has to delete.
    expect(r2.has(PRIVATE, 'chat/a.webp')).toBe(true);
    expect(r2.has(MAIN, 'chat/b.webp')).toBe(false);
  });

  it('counts a listing failure as a failure rather than a clean run', async () => {
    const { r2, target } = setup();
    r2.send.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'AccessDenied' }),
    );

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['chat/'],
    });

    expect(report.total.failed).toBe(1);
    expect(report.errors).toEqual(['AccessDenied']);
  });

  it('puts no object key and no error message in its report', async () => {
    const { r2, target } = setup();
    const key = 'chat/secret-name.webp';
    r2.put(MAIN, key, 'b');
    r2.copyError = Object.assign(new Error(`cannot copy ${key}`), {
      name: 'InternalError',
    });

    const report = await relocatePrivateMedia(target, {
      apply: true,
      prefixes: ['chat/'],
    });

    const printed = JSON.stringify(report);
    expect(printed).not.toContain('secret-name');
    expect(printed).not.toContain('cannot copy');
  });

  describe('without apply', () => {
    it('only lists and heads the private bucket; nothing is copied or deleted', async () => {
      const { r2, target } = setup();
      r2.put(MAIN, 'chat/new.webp', 'bytes');
      r2.put(MAIN, 'chat/done.webp', 'same');
      r2.put(PRIVATE, 'chat/done.webp', 'same');
      const moved: string[] = [];

      const report = await relocatePrivateMedia(target, {
        apply: false,
        prefixes: ['chat/'],
        onRelocated: (k) => moved.push(k),
      });

      expect(report.total).toMatchObject({
        scanned: 2,
        pending: 1,
        alreadyPresent: 1,
        copied: 0,
        deleted: 0,
      });
      expect(r2.sent('CopyObjectCommand')).toHaveLength(0);
      expect(r2.sent('DeleteObjectCommand')).toHaveLength(0);
      expect(
        r2.sent('HeadObjectCommand').every((c) => c.bucket === PRIVATE),
      ).toBe(true);
      expect(r2.has(MAIN, 'chat/new.webp')).toBe(true);
      expect(moved).toEqual([]);
    });
  });
});

describe('isObjectNotFound', () => {
  it('recognises what the SDK throws for an absent object', () => {
    expect(isObjectNotFound(notFoundError('NotFound'))).toBe(true);
    expect(isObjectNotFound(notFoundError('NoSuchKey'))).toBe(true);
    expect(
      isObjectNotFound(
        Object.assign(new Error('x'), { $metadata: { httpStatusCode: 404 } }),
      ),
    ).toBe(true);
  });

  it('does not take other failures for absence', () => {
    expect(isObjectNotFound(new Error('boom'))).toBe(false);
    expect(
      isObjectNotFound(Object.assign(new Error('x'), { name: 'AccessDenied' })),
    ).toBe(false);
    expect(isObjectNotFound('NotFound')).toBe(false);
    expect(isObjectNotFound(null)).toBe(false);
  });
});
