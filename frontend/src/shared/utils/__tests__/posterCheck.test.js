/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let pixelsBlank = true;
vi.mock('../blankFrame', () => ({ isBlankFrame: () => pixelsBlank }));

const STORAGE_KEY = 'meetifyy_poster_verdicts_v1';
const URL_A = 'https://media.example.test/posts/a_thumb.webp';
const DAY = 24 * 60 * 60 * 1000;

async function freshModule() {
  vi.resetModules();
  return import('../posterCheck');
}

describe('posterCheck', () => {
  let fetchMock;

  beforeEach(() => {
    localStorage.clear();
    pixelsBlank = true;
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ close() {} })));
    URL.createObjectURL = vi.fn(() => 'blob:fresh');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('probes the current file past the HTTP cache, with CORS', async () => {
    const { isPosterBlank } = await freshModule();
    await isPosterBlank(URL_A);
    expect(fetchMock).toHaveBeenCalledWith(URL_A, expect.objectContaining({ mode: 'cors', cache: 'reload' }));
  });

  it('remembers a blank poster with the time it was checked', async () => {
    const { isPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[URL_A]).toBeGreaterThan(1);
  });

  it('offers the fresh copy of a fine poster for this session (a stale cached copy may be on screen)', async () => {
    pixelsBlank = false;
    const { isPosterBlank, freshPosterUrl, whenPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(false);
    expect(freshPosterUrl(`${URL_A}?sig=2`)).toBe('blob:fresh');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[URL_A]).toBe(0);

    const onBlank = vi.fn();
    const onFresh = vi.fn();
    whenPosterBlank(URL_A, onBlank, onFresh);
    await new Promise((r) => setTimeout(r, 0));
    expect(onBlank).not.toHaveBeenCalled();
    expect(onFresh).toHaveBeenCalledWith('blob:fresh');
  });

  it('an unreadable poster is neither blank nor remembered', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { isPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('trusts a recent blank verdict without probing again', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [URL_A]: Date.now() - 1000 }));
    pixelsBlank = false;
    const { isPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-checks an expired blank verdict and accepts a repaired poster', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [URL_A]: Date.now() - DAY - 1000 }));
    pixelsBlank = false;
    const { isPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[URL_A]).toBe(0);
  });

  it('treats a legacy verdict (1, no time) as expired', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [URL_A]: 1 }));
    pixelsBlank = false;
    const { isPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a fine verdict for good', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [URL_A]: 0 }));
    const { isPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshBlankPosters re-fetches stored blank posters of either format', async () => {
    const URL_B = 'https://media.example.test/posts/b_thumb.webp';
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [URL_A]: 1, [URL_B]: Date.now() }));
    const { refreshBlankPosters } = await freshModule();
    await refreshBlankPosters();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
