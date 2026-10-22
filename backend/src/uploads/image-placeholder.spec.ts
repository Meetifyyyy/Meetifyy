import type { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import {
  IMAGE_PLACEHOLDER_MAX_CHARS,
  parseImagePlaceholder,
  parseImagePlaceholderShape,
  readStoredImagePlaceholder,
} from './image-placeholder.util';
import type { StorageProvider } from './providers/storage-provider.interface';
import { StorageService } from './uploads.service';
import { withMediaUrl } from '../posts/post-view';
import { stub } from '../common/testing/stub';
import type { PrismaService } from '../prisma/prisma.service';

/** A minimal but real-looking WebP: RIFF header, WEBP, then filler bytes. */
const webpBytes = () =>
  Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x20, 0, 0, 0]),
    Buffer.from('WEBPVP8 '),
    Buffer.alloc(24, 7),
  ]);
const jpegBytes = () =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 9)]);

const WEBP = `data:image/webp;base64,${webpBytes().toString('base64')}`;
const JPEG = `data:image/jpeg;base64,${jpegBytes().toString('base64')}`;

const realImage = async (
  kind: 'webp' | 'jpeg',
  size: number,
): Promise<string> => {
  const base = sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  });
  const buf = await (kind === 'webp' ? base.webp() : base.jpeg()).toBuffer();
  return `data:image/${kind};base64,${buf.toString('base64')}`;
};

describe('parseImagePlaceholder (decoded)', () => {
  it('accepts a real 16px WebP and JPEG', async () => {
    const webp = await realImage('webp', 16);
    const jpeg = await realImage('jpeg', 16);
    await expect(parseImagePlaceholder(webp)).resolves.toBe(webp);
    await expect(parseImagePlaceholder(jpeg)).resolves.toBe(jpeg);
  });

  it('accepts exactly 64px and rejects 65px', async () => {
    const ok = await realImage('webp', 64);
    expect(ok.length).toBeLessThanOrEqual(IMAGE_PLACEHOLDER_MAX_CHARS);
    await expect(parseImagePlaceholder(ok)).resolves.toBe(ok);
    const big = await realImage('webp', 65);
    await expect(parseImagePlaceholder(big)).resolves.toBeNull();
  });

  it('rejects a correct signature that is not a decodable image', async () => {
    await expect(parseImagePlaceholder(WEBP)).resolves.toBeNull();
    await expect(parseImagePlaceholder(JPEG)).resolves.toBeNull();
  });

  it('rejects a truncated real image', async () => {
    const full = await realImage('jpeg', 16);
    const bytes = Buffer.from(full.split(',')[1], 'base64');
    const cut = bytes.subarray(0, Math.floor(bytes.length / 2));
    // Re-pad to a whole number of base64 groups so only decoding can fail.
    await expect(
      parseImagePlaceholder(`data:image/jpeg;base64,${cut.toString('base64')}`),
    ).resolves.toBeNull();
  });

  it('rejects a real image whose type differs from the declared one', async () => {
    const webp = await realImage('webp', 16);
    await expect(
      parseImagePlaceholder(webp.replace('image/webp', 'image/jpeg')),
    ).resolves.toBeNull();
  });

  it('never throws on junk', async () => {
    for (const bad of [undefined, null, 5, {}, 'javascript:alert(1)']) {
      await expect(parseImagePlaceholder(bad)).resolves.toBeNull();
    }
  });
});

describe('parseImagePlaceholderShape', () => {
  it('accepts a base64 WebP and a base64 JPEG data URL', () => {
    expect(parseImagePlaceholderShape(WEBP)).toBe(WEBP);
    expect(parseImagePlaceholderShape(JPEG)).toBe(JPEG);
  });

  it('rejects anything that is not a string', () => {
    for (const bad of [undefined, null, 5, {}, [], ['x'], true]) {
      expect(parseImagePlaceholderShape(bad)).toBeNull();
    }
  });

  it('rejects a string over the length cap', () => {
    const big = `data:image/webp;base64,${Buffer.concat([
      webpBytes(),
      Buffer.alloc(IMAGE_PLACEHOLDER_MAX_CHARS),
    ]).toString('base64')}`;
    expect(big.length).toBeGreaterThan(IMAGE_PLACEHOLDER_MAX_CHARS);
    expect(parseImagePlaceholderShape(big)).toBeNull();
  });

  it('rejects types other than WebP and JPEG, including SVG', () => {
    const body = webpBytes().toString('base64');
    expect(
      parseImagePlaceholderShape(`data:image/svg+xml;base64,${body}`),
    ).toBeNull();
    expect(
      parseImagePlaceholderShape(`data:image/png;base64,${body}`),
    ).toBeNull();
    expect(
      parseImagePlaceholderShape(`data:image/gif;base64,${body}`),
    ).toBeNull();
    expect(
      parseImagePlaceholderShape(`data:text/html;base64,${body}`),
    ).toBeNull();
    expect(
      parseImagePlaceholderShape(
        `data:image/svg+xml;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`,
      ),
    ).toBeNull();
  });

  it('rejects script, urls and non-base64 payloads', () => {
    expect(parseImagePlaceholderShape('javascript:alert(1)')).toBeNull();
    expect(
      parseImagePlaceholderShape('https://evil.example/x.webp'),
    ).toBeNull();
    expect(
      parseImagePlaceholderShape('data:image/webp;base64,<script>'),
    ).toBeNull();
    expect(
      parseImagePlaceholderShape('data:image/webp,RIFFxxxxWEBP'),
    ).toBeNull();
    // Closes the CSS url() it would be written into.
    expect(
      parseImagePlaceholderShape(`${WEBP}");background:url("//evil.example`),
    ).toBeNull();
    expect(parseImagePlaceholderShape(`${WEBP}\n`)).toBeNull();
    expect(parseImagePlaceholderShape(` ${WEBP}`)).toBeNull();
  });

  it('rejects bytes that are not the image type the header claims', () => {
    const html = Buffer.from('<html><body>hello world, not an image</body>');
    expect(
      parseImagePlaceholderShape(
        `data:image/webp;base64,${html.toString('base64')}`,
      ),
    ).toBeNull();
    // A JPEG labelled WebP, and the reverse.
    expect(
      parseImagePlaceholderShape(
        `data:image/webp;base64,${jpegBytes().toString('base64')}`,
      ),
    ).toBeNull();
    expect(
      parseImagePlaceholderShape(
        `data:image/jpeg;base64,${webpBytes().toString('base64')}`,
      ),
    ).toBeNull();
  });

  it('rejects truncated or badly padded base64', () => {
    expect(parseImagePlaceholderShape(WEBP.slice(0, -1))).toBeNull();
    expect(parseImagePlaceholderShape('data:image/webp;base64,')).toBeNull();
    expect(
      parseImagePlaceholderShape('data:image/webp;base64,UklGRg=='),
    ).toBeNull();
  });
});

describe('readStoredImagePlaceholder', () => {
  it('returns a stored placeholder and ignores empty or foreign values', () => {
    expect(readStoredImagePlaceholder(WEBP)).toBe(WEBP);
    expect(readStoredImagePlaceholder(null)).toBeNull();
    expect(readStoredImagePlaceholder(undefined)).toBeNull();
    // Anything that is not a valid placeholder reads back as none.
    expect(
      readStoredImagePlaceholder('d41d8cd98f00b204e9800998ecf8427e'),
    ).toBeNull();
  });
});

describe('withMediaUrl placeholder', () => {
  it('exposes a valid stored placeholder', () => {
    const out = withMediaUrl({ objectKey: 'posts/a.webp', placeholder: WEBP });
    expect(out.placeholder).toBe(WEBP);
    expect(out.url).toBe('/api/media/posts/a.webp');
  });

  it('leaves a row without one exactly as it was (no key at all)', () => {
    expect(withMediaUrl({ objectKey: 'posts/a.webp' })).toEqual({
      objectKey: 'posts/a.webp',
      url: '/api/media/posts/a.webp',
    });
    expect(
      withMediaUrl({ objectKey: 'posts/a.webp', placeholder: null }),
    ).toEqual({
      objectKey: 'posts/a.webp',
      url: '/api/media/posts/a.webp',
    });
  });

  it('never serves a tampered stored value', () => {
    const out = withMediaUrl({
      objectKey: 'posts/a.webp',
      placeholder: 'data:image/svg+xml;base64,PHN2Zz4=',
    });
    expect(out).not.toHaveProperty('placeholder');
  });
});

describe('StorageService.getPresignedUrl placeholder', () => {
  let REAL_WEBP = '';
  beforeAll(async () => {
    REAL_WEBP = await realImage('webp', 16);
  });

  const build = () => {
    const create = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'm1', ...args.data }),
    );
    const upsert = jest.fn((args: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'm2', ...args.create }),
    );
    const service = new StorageService(
      stub<StorageProvider>({
        upload: jest.fn(() => Promise.resolve()),
        createSignedUploadUrl: jest.fn(
          (_f: string, _c: string, folder: string) =>
            Promise.resolve({
              uploadUrl: 'https://upload.example/x',
              key: `${folder}/0123456789abcdef0123456789abcdef.webp`,
              headers: {},
            }),
        ),
      }),
      stub<PrismaService>({ media: { create, upsert } }),
      stub<ConfigService>({ get: jest.fn(() => undefined) }),
    );
    return { service, create };
  };

  const presign = (
    service: StorageService,
    contentType: string,
    placeholder: unknown,
  ) =>
    service.getPresignedUrl(
      'u1',
      'a.webp',
      contentType,
      'posts',
      1000,
      undefined,
      800,
      600,
      undefined,
      placeholder,
    );

  it('stores a valid placeholder on the media row', async () => {
    const { service, create } = build();
    await presign(service, 'image/webp', REAL_WEBP);
    expect(create.mock.calls[0][0].data.placeholder).toBe(REAL_WEBP);
  });

  it('drops an invalid placeholder without failing the upload', async () => {
    const { service, create } = build();
    await expect(
      presign(service, 'image/webp', 'javascript:alert(1)'),
    ).resolves.toBeDefined();
    expect(create.mock.calls[0][0].data.placeholder).toBeUndefined();
  });

  it('works with no placeholder at all (installed older apps)', async () => {
    const { service, create } = build();
    await presign(service, 'image/webp', undefined);
    expect(create.mock.calls[0][0].data.placeholder).toBeUndefined();
  });

  it('stores it from the pass-through upload too, for images only', async () => {
    const { service, create } = build();
    const file = (mimetype: string) =>
      stub<Express.Multer.File>({
        mimetype,
        size: 1000,
        buffer: Buffer.from('x'),
        originalname: 'a',
      });
    await service.uploadFile(
      'u1',
      file('image/webp'),
      'posts',
      undefined,
      REAL_WEBP,
    );
    expect(create.mock.calls[0][0].data.placeholder).toBe(REAL_WEBP);
    await service.uploadFile(
      'u1',
      file('video/mp4'),
      'posts',
      undefined,
      REAL_WEBP,
    );
    expect(create.mock.calls[1][0].data.placeholder).toBeUndefined();
  });

  it('ignores a placeholder sent for a video', async () => {
    const { service, create } = build();
    await presign(service, 'video/mp4', REAL_WEBP);
    expect(create.mock.calls[0][0].data.placeholder).toBeUndefined();
  });
});
