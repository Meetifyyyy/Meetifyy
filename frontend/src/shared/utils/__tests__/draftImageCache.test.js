import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeIndexedDB } from '../../lib/__tests__/helpers/fakeIndexedDB';

/**
 * Draft photos are pictures picked for a post nobody has sent yet. They are
 * kept for 30 minutes so a refresh does not lose them, and must not outlive the
 * person who picked them: signing out wipes them all.
 */

vi.mock('../mediaPipeline', () => ({
  compressImage: vi.fn(async (file) => file),
  uploadFileDirect: vi.fn(),
  processAndUploadRemoteUrl: vi.fn(),
}));

const MIN = 60 * 1000;

let fake;
let mod;
let pipeline;
beforeEach(async () => {
  fake = installFakeIndexedDB();
  vi.stubGlobal('window', globalThis);
  vi.resetModules();
  pipeline = await import('../mediaPipeline');
  mod = await import('../draftImageCache');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const records = () => fake.db('meetifyy_draft_db').stores.get('draft_images').data;
const seed = (id, ageMs) => records().set(id, { id, blob: new Blob([id]), timestamp: Date.now() - ageMs });
const settle = () => new Promise((r) => setTimeout(r, 15));

describe('clearDraftImages', () => {
  it('deletes every draft, fresh ones included', async () => {
    await mod.cleanupDraftImages(); // opens the database
    seed('draft_img_a', 1 * MIN);
    seed('draft_img_b', 2 * MIN);
    seed('draft_img_old', 90 * MIN);

    await mod.clearDraftImages();

    expect(records().size).toBe(0);
  });

  it('has committed the wipe by the time it resolves', async () => {
    const { draftId } = await mod.compressAndCacheDraftImage(new Blob(['pixels'], { type: 'image/png' }));
    await settle();
    expect(records().has(draftId)).toBe(true);

    await mod.clearDraftImages();

    expect(records().size).toBe(0);
  });

  it('revokes the in-memory previews', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { previewUrl } = await mod.compressAndCacheDraftImage(new Blob(['pixels'], { type: 'image/png' }));
    await mod.clearDraftImages();
    expect(revoke).toHaveBeenCalledWith(previewUrl);
    revoke.mockRestore();
  });

  it('stops a photo still being compressed from being stored after the wipe', async () => {
    let finish;
    pipeline.compressImage.mockImplementationOnce(() => new Promise((res) => { finish = res; }));
    const pending = mod.compressAndCacheDraftImage(new Blob(['pixels'], { type: 'image/png' }));

    await mod.clearDraftImages(); // sign-out while the picked photo is still compressing
    finish(new Blob(['compressed'], { type: 'image/webp' }));
    const result = await pending;
    await settle();

    expect(result.previewUrl).toBe('');
    expect(records().size).toBe(0);
  });

  it('keeps caching for the next person after a wipe', async () => {
    await mod.clearDraftImages();
    const { draftId } = await mod.compressAndCacheDraftImage(new Blob(['pixels'], { type: 'image/png' }));
    await settle();
    expect(records().has(draftId)).toBe(true);
  });

  it('resolves where IndexedDB is unavailable', async () => {
    vi.stubGlobal('window', {});
    await expect(mod.clearDraftImages()).resolves.toBeUndefined();
  });
});

describe('cleanupDraftImages', () => {
  it('sweeps only drafts older than the lifetime, and resolves once that has committed', async () => {
    await mod.cleanupDraftImages();
    seed('draft_img_fresh', 5 * MIN);
    seed('draft_img_old', 31 * MIN);
    seed('draft_img_ancient', 600 * MIN);

    await mod.cleanupDraftImages();

    expect([...records().keys()]).toEqual(['draft_img_fresh']);
  });
});
