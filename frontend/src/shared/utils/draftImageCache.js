import { compressImage, uploadFileDirect, processAndUploadRemoteUrl } from './mediaPipeline';

const DB_NAME = 'meetifyy_draft_db';
const DB_VERSION = 1;
const STORE_NAME = 'draft_images';
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

const activeDrafts = new Map(); // previewUrl -> { draftId, blob, timestamp }

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

  const draftId = `draft_img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const previewUrl = URL.createObjectURL(blob);
  const record = { id: draftId, previewUrl, blob, timestamp: Date.now() };

  activeDrafts.set(previewUrl, record);
  activeDrafts.set(draftId, record);

  try {
    const db = await openDraftDB();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id: draftId, blob, timestamp: Date.now() });
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
 */
export async function cleanupDraftImages(maxAgeMs = DEFAULT_TTL_MS) {
  try {
    const db = await openDraftDB();
    if (!db) return;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    const now = Date.now();

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const item = cursor.value;
        if (now - item.timestamp > maxAgeMs) {
          store.delete(item.id);
          removeDraftImage(item.id);
        }
        cursor.continue();
      }
    };
  } catch (err) {
    // silent fail
  }
}

// Auto cleanup old drafts on launch
if (typeof window !== 'undefined') {
  setTimeout(() => cleanupDraftImages(), 2000);
  setInterval(() => cleanupDraftImages(), 15 * 60 * 1000);
}
