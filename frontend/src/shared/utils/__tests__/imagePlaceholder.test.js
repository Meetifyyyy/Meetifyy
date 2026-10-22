/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLACEHOLDER_EDGE,
  PLACEHOLDER_MAX_CHARS,
  PLACEHOLDER_TIMEOUT_MS,
  generateImagePlaceholder,
  placeholderSize,
  safePlaceholder,
} from '../imagePlaceholder';

const WEBP = `data:image/webp;base64,${btoa('RIFF \u0000\u0000\u0000WEBPVP8 abcdefghijklmnopqrstuvwxyz')}`;
const JPEG = `data:image/jpeg;base64,${btoa('ÿØÿà abcdefghijklmnopqrstuvwxyz')}`;

describe('placeholderSize', () => {
  it('scales the longest side to the edge and keeps the shape', () => {
    expect(placeholderSize(1600, 800)).toEqual({ width: PLACEHOLDER_EDGE, height: 8 });
    expect(placeholderSize(800, 1600)).toEqual({ width: 8, height: PLACEHOLDER_EDGE });
    expect(placeholderSize(1000, 1000)).toEqual({ width: 16, height: 16 });
  });

  it('never upscales and never reaches zero', () => {
    expect(placeholderSize(10, 4)).toEqual({ width: 10, height: 4 });
    expect(placeholderSize(4000, 10)).toEqual({ width: 16, height: 1 });
  });

  it('gives null for unusable dimensions', () => {
    expect(placeholderSize(0, 10)).toBeNull();
    expect(placeholderSize(undefined, undefined)).toBeNull();
    expect(placeholderSize(-5, 5)).toBeNull();
    expect(placeholderSize('x', 5)).toBeNull();
  });
});

describe('safePlaceholder', () => {
  it('passes a base64 WebP/JPEG data URL through', () => {
    expect(safePlaceholder(WEBP)).toBe(WEBP);
    expect(safePlaceholder(JPEG)).toBe(JPEG);
  });

  it('refuses anything that could escape a CSS url() or is not an image', () => {
    expect(safePlaceholder(undefined)).toBeNull();
    expect(safePlaceholder(null)).toBeNull();
    expect(safePlaceholder(5)).toBeNull();
    expect(safePlaceholder('https://x.test/a.webp')).toBeNull();
    expect(safePlaceholder('javascript:alert(1)')).toBeNull();
    expect(safePlaceholder('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(safePlaceholder(`${WEBP}");background:url("//evil`)).toBeNull();
    expect(safePlaceholder(`${WEBP}\n`)).toBeNull();
  });

  it('refuses an oversized string', () => {
    const big = `data:image/webp;base64,${'A'.repeat(PLACEHOLDER_MAX_CHARS)}`;
    expect(safePlaceholder(big)).toBeNull();
  });
});

describe('generateImagePlaceholder', () => {
  const stubs = (encoder) => {
    const drawImage = vi.fn();
    const sizes = [];
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 1600, height: 800, close: vi.fn() }));
    globalThis.OffscreenCanvas = class {
      constructor(w, h) { sizes.push([w, h]); }
      getContext() { return { drawImage, fillRect() {} }; }
      convertToBlob({ type }) { return encoder(type); }
    };
    return { drawImage, sizes };
  };
  const blobOf = (type, text) => new Blob([text], { type });

  afterEach(() => {
    delete globalThis.createImageBitmap;
    delete globalThis.OffscreenCanvas;
  });

  it('skips GIFs without decoding them', async () => {
    stubs(async (type) => blobOf(type, 'x'));
    expect(await generateImagePlaceholder(blobOf('image/gif', 'GIF89a'))).toBeNull();
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('asks for a downscaled decode, and decodes normally where that is refused', async () => {
    const { sizes } = stubs(async () => null);
    globalThis.createImageBitmap = vi.fn(async (_src, opts) => {
      if (opts) throw new TypeError('options not supported');
      return { width: 1600, height: 800, close: vi.fn() };
    });
    await generateImagePlaceholder(blobOf('image/jpeg', 'x'));
    expect(globalThis.createImageBitmap.mock.calls[0][1]).toMatchObject({ resizeWidth: 64 });
    expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
    expect(sizes[0]).toEqual([PLACEHOLDER_EDGE, PLACEHOLDER_EDGE / 2]);
  });

  it('gives up with null rather than holding an upload when decoding hangs', async () => {
    vi.useFakeTimers();
    try {
      stubs(async () => null);
      globalThis.createImageBitmap = vi.fn(() => new Promise(() => {}));
      const pending = generateImagePlaceholder(blobOf('image/jpeg', 'x'));
      await vi.advanceTimersByTimeAsync(PLACEHOLDER_TIMEOUT_MS);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws a ~16px copy and returns it as a WebP data URL', async () => {
    const { drawImage, sizes } = stubs(async (type) => blobOf(type, 'RIFF \u0000\u0000\u0000WEBPVP8 abcdefghijklmnop'));
    const out = await generateImagePlaceholder(new Blob(['x'], { type: 'image/webp' }));
    expect(sizes).toEqual([[16, 8]]);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 16, 8);
    expect(out).toMatch(/^data:image\/webp;base64,/);
    expect(safePlaceholder(out)).toBe(out);
  });

  it('falls back to JPEG where WebP cannot be encoded', async () => {
    stubs(async (type) => (type === 'image/webp' ? blobOf('image/png', 'png') : blobOf(type, 'ÿØÿà abcdef')));
    const out = await generateImagePlaceholder(new Blob(['x'], { type: 'image/jpeg' }));
    expect(out).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('gives null when the result is over the size cap', async () => {
    stubs(async (type) => blobOf(type, 'x'.repeat(5000)));
    expect(await generateImagePlaceholder(new Blob(['x']))).toBeNull();
  });

  it('gives null, without throwing, when the image cannot be decoded or is missing', async () => {
    globalThis.createImageBitmap = vi.fn(async () => { throw new Error('bad image'); });
    expect(await generateImagePlaceholder(new Blob(['x']))).toBeNull();
    expect(await generateImagePlaceholder(null)).toBeNull();
    delete globalThis.createImageBitmap;
    expect(await generateImagePlaceholder(new Blob(['x']))).toBeNull();
  });
});
