/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let pixelsBlank = true;
vi.mock('../blankFrame', () => ({ isBlankFrame: () => pixelsBlank }));

const STORAGE_KEY = 'meetifyy_poster_verdicts_v1';
const URL_A = 'https://media.example.test/posts/a_thumb.webp';
const DAY = 24 * 60 * 60 * 1000;

/** An Image whose load fires on the next tick, so the probe completes. */
class FakeImage {
  set src(value) {
    this._src = value;
    setTimeout(() => this.onload?.(), 0);
  }
  get src() { return this._src; }
}

async function freshModule() {
  vi.resetModules();
  return import('../posterCheck');
}

describe('posterCheck blank verdicts', () => {
  let fetchMock;

  beforeEach(() => {
    localStorage.clear();
    pixelsBlank = true;
    vi.stubGlobal('Image', FakeImage);
    fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('remembers a blank poster with the time it was checked', async () => {
    const { isPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(true);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(saved[URL_A]).toBeGreaterThan(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('trusts a recent blank verdict without probing again', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [URL_A]: Date.now() - 1000 }));
    pixelsBlank = false;
    const { isPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-checks an expired blank verdict past the HTTP cache and accepts a repaired poster', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [URL_A]: Date.now() - DAY - 1000 }));
    pixelsBlank = false; // the backfill replaced it
    const { isPosterBlank } = await freshModule();
    expect(await isPosterBlank(URL_A)).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(URL_A, expect.objectContaining({ cache: 'reload' }));
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
    pixelsBlank = true;
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
