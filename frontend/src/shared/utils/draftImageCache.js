import { compressImage, uploadFileDirect, processAndUploadRemoteUrl } from './mediaPipeline';
import { newIdempotencyKey } from '@shared/lib/idempotencyKey';

const DB_NAME = 'meetifyy_draft_db';
const DB_VERSION = 1;
const STORE_NAME = 'draft_images';
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

const activeDrafts = new Map(); // previewUrl -> { draftId, blob, timestamp }

// Bumped by clearDraftImages(). A compression that was running when the person
// signed out finishes under the old value and writes nothing, so a photo picked
// as the previous account is not stored after the wipe for the next one.
let clearGeneration = 0;

/**
 * Opens or initializes the draft images IndexedDB database.
 */
function openDraftDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Compresses an image/file or remote URL to WebP and caches it in local IndexedDB device storage.
 * Returns { draftId, previewUrl, blob }.
 */
export async function compressAndCacheDraftImage(fileOrUrl, options = {}) {
  let blob;
  const generationAtStart = clearGeneration;
  
  if (typeof fileOrUrl === 'string') {
    if (fileOrUrl.startsWith('blob:')) {
      // Already a blob URL, if in activeDrafts return it
      const existing = activeDrafts.get(fileOrUrl);
      if (existing) return existing;
    }
    try {
      const res = await fetch(fileOrUrl);
      const fetchedBlob = await res.blob();
      const contentType = fetchedBlob.type || (fileOrUrl.includes('.gif') ? 'image/gif' : 'image/jpeg');
      const file = new File([fetchedBlob], `draft-${Date.now()}.${contentType.includes('gif') ? 'gif' : 'webp'}`, { type: contentType });
      blob = await compressImage(file, { maxWidthOrHeight: 1280, fileType: 'image/webp', ...options });
    } catch (err) {
      console.warn('Failed to fetch/compress remote draft image:', err);
      return { previewUrl: fileOrUrl, blob: null };
    }
  } else if (fileOrUrl instanceof Blob || fileOrUrl instanceof File) {
    try {
      blob = await compressImage(fileOrUrl, { maxWidthOrHeight: 1280, fileType: 'image/webp', ...options });
    } catch (err) {
      console.warn('Failed to compress local draft file, falling back to original:', err);
      blob = fileOrUrl;
    }
  } else {
    return { previewUrl: '', blob: null };
  }

  // Signed out while the image was being fetched or compressed.
  if (generationAtStart !== clearGeneration) return { previewUrl: '', blob: null };

  // The CSPRNG, never Math.random (CLAUDE.md §8): this is an id.
  const draftId = `draft_img_${Date.now()}_${newIdempotencyKey() || 'x'}`;
  const previewUrl = URL.createObjectURL(blob);
  const record = { id: draftId, previewUrl, blob, timestamp: Date.now() };

  activeDrafts.set(previewUrl, record);
  activeDrafts.set(draftId, record);

  try {
    const db = await openDraftDB();
    if (db) {
      // Checked again after the open: a sign-out during it has already wiped
      // the database, and this photo belongs to the account that left.
      if (generationAtStart !== clearGeneration) {
        db.close();
        activeDrafts.delete(previewUrl);
        activeDrafts.delete(draftId);
        try { URL.revokeObjectURL(previewUrl); } catch (_) { /* already revoked */ }
        return { previewUrl: '', blob: null };
      }
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id: draftId, blob, timestamp: Date.now() });
      await new Promise((resolve) => {
        tx.oncomplete = resolve;
        tx.onerror = resolve;
        tx.onabort = resolve;
      });
      db.close();
    }
  } catch (err) {
    console.warn('IndexedDB write failed for draft image:', err);
  }

  return { draftId, previewUrl, blob };
}

/**
 * Uploads a cached draft image (or remote URL) to database storage when user submits/creates activity.
 * Removes the draft from local cache after successful upload.
 */
export async function commitDraftImage(imageSource, folder = 'general') {
  if (!imageSource) return null;

  // 1. Check if imageSource is in activeDrafts memory or IndexedDB
  let draftRecord = activeDrafts.get(imageSource);
  
  if (!draftRecord && typeof imageSource === 'string' && imageSource.startsWith('draft_img_')) {
    try {
      const db = await openDraftDB();
      if (db) {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(imageSource);
        const res = await new Promise((resolve) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });
        if (res) draftRecord = res;
      }
    } catch (err) {
      console.warn('Error reading draft from IDB:', err);
    }
  }

  // 2. If we have a local compressed blob draft, upload it directly to database storage
  if (draftRecord && draftRecord.blob) {
    const file = new File([draftRecord.blob], `activity-cover-${Date.now()}.${draftRecord.blob.type.includes('gif') ? 'gif' : 'webp'}`, { type: draftRecord.blob.type });
    const { publicUrl } = await uploadFileDirect(file, folder);

    // Clean up local draft cache
    removeDraftImage(imageSource);
    if (draftRecord.id) removeDraftImage(draftRecord.id);
    if (draftRecord.previewUrl) removeDraftImage(draftRecord.previewUrl);

    return publicUrl;
  }

  // 3. If it's a blob: URL without record in memory (e.g. created directly), fetch blob & upload
  if (typeof imageSource === 'string' && imageSource.startsWith('blob:')) {
    try {
      const res = await fetch(imageSource);
      const blob = await res.blob();
      const file = new File([blob], `activity-cover-${Date.now()}.${blob.type.includes('gif') ? 'gif' : 'webp'}`, { type: blob.type });
      const { publicUrl } = await uploadFileDirect(file, folder);
      try { URL.revokeObjectURL(imageSource); } catch (_) {}
      return publicUrl;
    } catch (err) {
      console.error('Failed to commit blob URL image:', err);
    }
  }

  // 4. If it's a remote URL (e.g., preset URL or other external source)
  if (typeof imageSource === 'string' && (imageSource.startsWith('http://') || imageSource.startsWith('https://'))) {
    // If it's already on our storage backend (e.g. R2, Supabase, presets), no need to re-upload
    if (
      imageSource.includes('/storage/v1/object/') ||
      imageSource.includes('/uploads/') ||
      imageSource.includes('/presets/') ||
      imageSource.includes('.r2.dev') ||
      imageSource.includes('cdn.meetifyy.app')
    ) {
      return imageSource;
    }
    return await processAndUploadRemoteUrl(imageSource, folder);
  }

  return imageSource;
}

/**
 * Removes and revokes a draft image from local memory and IndexedDB.
 */
export async function removeDraftImage(draftIdOrUrl) {
  if (!draftIdOrUrl) return;

  const record = activeDrafts.get(draftIdOrUrl);
  if (record) {
    if (record.previewUrl && record.previewUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(record.previewUrl); } catch (_) {}
    }
    activeDrafts.delete(record.previewUrl);
    activeDrafts.delete(record.id);
  } else if (typeof draftIdOrUrl === 'string' && draftIdOrUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(draftIdOrUrl); } catch (_) {}
  }

  try {
    const db = await openDraftDB();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      if (typeof draftIdOrUrl === 'string' && draftIdOrUrl.startsWith('draft_img_')) {
        tx.objectStore(STORE_NAME).delete(draftIdOrUrl);
      }
    }
  } catch (err) {
    // silent
  }
}

/**
 * Deletes uncommitted draft images from local IndexedDB cache after TTL.
 * Resolves once the sweep has committed. Never rejects: it is housekeeping.
 */
export async function cleanupDraftImages(maxAgeMs = DEFAULT_TTL_MS) {
  let db = null;
  try {
    db = await openDraftDB();
    if (!db) return;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    const now = Date.now();
    const expired = [];

    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        const item = cursor.value;
        // A record with no usable timestamp can never be told to be fresh.
        if (!(now - item.timestamp <= maxAgeMs)) {
          store.delete(item.id);
          expired.push(item.id);
        }
        cursor.continue();
      };
    });
    // Their in-memory twins and blob URLs go too.
    expired.forEach((id) => { void removeDraftImage(id); });
  } catch (err) {
    // silent fail
  } finally {
    try { db?.close(); } catch (_) {}
  }
}

/**
 * Deletes EVERY draft image, expired or not, and resolves once the wipe has
 * committed.
 *
 * For sign-out. These are photos picked for a post or activity that was never
 * sent, held for 30 minutes so a refresh does not lose them; they are the
 * previous person's pictures, and the next account on the device must not be
 * able to read them. Also revokes the in-memory previews, and stops a
 * compression still in flight from storing its result afterwards.
 */
export async function clearDraftImages() {
  clearGeneration += 1;

  for (const record of new Set(activeDrafts.values())) {
    if (record?.previewUrl && record.previewUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(record.previewUrl); } catch (_) {}
    }
  }
  activeDrafts.clear();

  let db = null;
  try {
    db = await openDraftDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  } catch (err) {
    // silent: nothing to wipe where storage is unavailable
  } finally {
    try { db?.close(); } catch (_) {}
  }
}

// Sweep old drafts periodically while the module is loaded. The launch-time
// sweep is part of the startup storage maintenance (shared/lib/storageMaintenance.js),
// which does not depend on this module having been imported by a screen first.
if (typeof window !== 'undefined') {
  const timer = setInterval(() => cleanupDraftImages(), 15 * 60 * 1000);
  timer?.unref?.();
}
