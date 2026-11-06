/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateVideoPosterFromUrl = vi.fn();
const uploadFileDirect = vi.fn();
vi.mock('../mediaPipeline', () => ({
  generateVideoPosterFromUrl: (...args) => generateVideoPosterFromUrl(...args),
  uploadFileDirect: (...args) => uploadFileDirect(...args),
}));
vi.mock('@shared/api/apiClient', () => ({
  deriveThumbnailKey: (key) => key.replace(/\.[a-z0-9]+$/i, '_thumb.webp'),
}));

const frame = () => ({ posterBlob: new Blob(['x'], { type: 'image/webp' }), width: 10, height: 20 });

async function fresh() {
  vi.resetModules();
  return import('../generatedPoster');
}

describe('generatedPoster', () => {
  beforeEach(() => {
    generateVideoPosterFromUrl.mockReset();
    uploadFileDirect.mockReset().mockResolvedValue({});
    URL.createObjectURL = vi.fn(() => 'blob:frame');
    URL.revokeObjectURL = vi.fn();
  });

  it('draws one frame per video, whatever its signature', async () => {
    generateVideoPosterFromUrl.mockResolvedValue(frame());
    const { getGeneratedPoster } = await fresh();
    const a = await getGeneratedPoster('https://m.test/chat/a.mp4?sig=1');
    const b = await getGeneratedPoster('https://m.test/chat/a.mp4?sig=2');
    expect(a).toBe('blob:frame');
    expect(b).toBe('blob:frame');
    expect(generateVideoPosterFromUrl).toHaveBeenCalledTimes(1);
  });

  it('gives null when no frame could be drawn', async () => {
    generateVideoPosterFromUrl.mockResolvedValue({ posterBlob: null });
    const { getGeneratedPoster } = await fresh();
    expect(await getGeneratedPoster('https://m.test/posts/b.mp4')).toBeNull();
  });

  it('never runs for local blob/data sources', async () => {
    const { getGeneratedPoster } = await fresh();
    expect(await getGeneratedPoster('blob:local')).toBeNull();
    expect(generateVideoPosterFromUrl).not.toHaveBeenCalled();
  });

  it("stores the frame as the original's thumbnail only when given a repair key", async () => {
    generateVideoPosterFromUrl.mockResolvedValue(frame());
    const { getGeneratedPoster } = await fresh();
    await getGeneratedPoster('https://m.test/posts/c.mp4');
    await new Promise((r) => setTimeout(r, 0));
    expect(uploadFileDirect).not.toHaveBeenCalled();

    await getGeneratedPoster('https://m.test/posts/d.mp4', { repairKey: 'posts/d.mp4' });
    await new Promise((r) => setTimeout(r, 0));
    expect(uploadFileDirect).toHaveBeenCalledTimes(1);
    const [file, folder, , , variantKey, meta] = uploadFileDirect.mock.calls[0];
    expect(file.type).toBe('image/webp');
    expect(folder).toBe('posts');
    expect(variantKey).toBe('posts/d_thumb.webp');
    expect(meta).toEqual({ width: 10, height: 20 });
  });

  it('draws at most two at a time', async () => {
    let active = 0;
    let peak = 0;
    generateVideoPosterFromUrl.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return frame();
    });
    const { getGeneratedPoster } = await fresh();
    await Promise.all(['e', 'f', 'g', 'h'].map((n) => getGeneratedPoster(`https://m.test/posts/${n}.mp4`)));
    expect(peak).toBe(2);
  });
});
