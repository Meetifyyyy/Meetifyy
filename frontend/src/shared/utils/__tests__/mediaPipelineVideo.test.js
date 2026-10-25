/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ post: vi.fn(), discard: vi.fn(() => Promise.resolve({})) }));

vi.mock('../../api/apiClient', () => ({
  apiClient: { post: api.post },
  uploadsApi: { discard: api.discard },
  deriveThumbnailKey: (key) => key.replace(/\.[a-z0-9]+$/i, '_thumb.webp'),
  getBackendUrl: () => 'http://api.test',
  getAccessToken: () => null,
  getNativeSessionId: () => null,
}));

const { processAndUploadVideo, isMediaRejection } = await import('../mediaPipeline');

const MB = 1024 * 1024;
const MP4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
const clip = (size = 1000) => {
  const file = new File([MP4], 'clip.mp4', { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};
const meta = (posterBlob = null) => ({ posterBlob, width: 1080, height: 1920, duration: 12 });

/** XHR that completes every PUT, unless told to hang until aborted. */
class FakeXHR {
  static sent = [];
  static hangFrom = Infinity;
  constructor() { this.upload = {}; this.headers = {}; }
  open(method, url) { this.url = url; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(body) {
    FakeXHR.sent.push(this);
    if (FakeXHR.sent.length >= FakeXHR.hangFrom) return;
    queueMicrotask(() => { this.status = 200; this.response = ''; this.onload?.(); });
  }
  abort() { this.onabort?.(); }
}

let keyCount;
function presignResponder({ presignError, confirmError } = {}) {
  api.post.mockImplementation(async (path, body) => {
    if (path === '/api/media/presigned-url') {
      if (presignError) throw presignError;
      keyCount += 1;
      const key = body.variantKey || `chat/k${keyCount}.mp4`;
      return { uploadUrl: 'https://r2.example/put', publicUrl: `/api/media/${key}`, key, mediaId: `m${keyCount}`, headers: {} };
    }
    if (path === '/api/media/confirm') {
      if (confirmError) throw confirmError;
      return {};
    }
    if (path === '/api/media/upload') return { publicUrl: '/api/media/chat/fallback.mp4', key: 'chat/fallback.mp4' };
    throw new Error(`unexpected ${path}`);
  });
}
const httpError = (status, message) => Object.assign(new Error(message), { status });
const presignCalls = () => api.post.mock.calls.filter(([p]) => p === '/api/media/presigned-url');

beforeEach(() => {
  keyCount = 0;
  FakeXHR.sent = [];
  FakeXHR.hangFrom = Infinity;
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  api.post.mockReset();
  api.discard.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('processAndUploadVideo', () => {
  it('reuses a poster the caller already made, and sends its size and length', async () => {
    presignResponder();
    const createElement = vi.spyOn(document, 'createElement');
    const res = await processAndUploadVideo(clip(), 'chat', null, null, { meta: meta(new Blob(['p'], { type: 'image/webp' })) });
    // The clip was not decoded a second time.
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(presignCalls()[0][1]).toMatchObject({ width: 1080, height: 1920, duration: 12, fileSize: 1000, folder: 'chat' });
    expect(presignCalls()[1][1]).toMatchObject({ variantKey: 'chat/k1_thumb.webp' });
    expect(res.thumbnailUrl).toBe('/api/media/chat/k1_thumb.webp');
    expect(res).toMatchObject({ width: 1080, height: 1920, duration: 12 });
  });

  it('reports no thumbnail rather than the clip itself when there is no poster', async () => {
    presignResponder();
    const res = await processAndUploadVideo(clip(), 'chat', null, null, { meta: meta(null) });
    expect(res.publicUrl).toBe('/api/media/chat/k1.mp4');
    expect(res.thumbnailUrl).toBeNull();
  });

  it('refuses a message video over 15 MB before contacting the server', async () => {
    presignResponder();
    const err = await processAndUploadVideo(clip(15 * MB + 1), 'chat', null, null, { meta: meta() }).catch((e) => e);
    expect(err.message).toBe('Video must be 15 MB or less');
    expect(isMediaRejection(err)).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('allows a post video of 25 MB that a message would refuse', async () => {
    presignResponder();
    await expect(processAndUploadVideo(clip(25 * MB), 'posts', null, null, { meta: meta() })).resolves.toBeTruthy();
    await expect(processAndUploadVideo(clip(25 * MB), 'chat', null, null, { meta: meta() })).rejects.toThrow('15 MB');
  });

  it('stops on a 413 from the presign instead of re-uploading through the API', async () => {
    presignResponder({ presignError: httpError(413, 'Video must be 15 MB or less') });
    const err = await processAndUploadVideo(clip(), 'chat', null, null, { meta: meta() }).catch((e) => e);
    expect(err.status).toBe(413);
    expect(isMediaRejection(err)).toBe(true);
    expect(api.post.mock.calls.some(([p]) => p === '/api/media/upload')).toBe(false);
  });

  it('treats a 413 from the confirm as a failed upload, not a warning', async () => {
    presignResponder({ confirmError: httpError(413, 'Video must be 15 MB or less') });
    const err = await processAndUploadVideo(clip(), 'chat', null, null, { meta: meta() }).catch((e) => e);
    expect(err.message).toBe('Video must be 15 MB or less');
    expect(err.status).toBe(413);
    expect(api.post.mock.calls.some(([p]) => p === '/api/media/upload')).toBe(false);
  });

  it('still succeeds when a confirm merely fails to arrive', async () => {
    presignResponder({ confirmError: httpError(503, 'unavailable') });
    await expect(processAndUploadVideo(clip(), 'chat', null, null, { meta: meta() })).resolves.toMatchObject({ key: 'chat/k1.mp4' });
  });

  it('takes back the stored clip when the upload is cancelled during its poster', async () => {
    presignResponder();
    FakeXHR.hangFrom = 2; // the clip lands; the poster PUT never finishes
    const controller = new AbortController();
    const pending = processAndUploadVideo(clip(), 'chat', null, controller.signal, { meta: meta(new Blob(['p'])) });
    await vi.waitFor(() => expect(FakeXHR.sent).toHaveLength(2));
    controller.abort();
    const err = await pending.catch((e) => e);
    expect(err.name).toBe('AbortError');
    expect(api.discard).toHaveBeenCalledWith('chat/k1.mp4');
  });
});
