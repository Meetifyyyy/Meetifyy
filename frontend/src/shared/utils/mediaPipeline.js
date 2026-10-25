/**
 * The compressor (~52 KB), loaded on the first upload rather than at startup.
 *
 * This module is reached from the composer and the share sheet, both of which
 * are on the Home screen, so a static import parsed the library on every
 * launch for a feature most launches never use.
 */
let compressorPromise = null;
const loadCompressor = () => {
  compressorPromise ??= import('browser-image-compression')
    .then((m) => m.default)
    .catch((err) => {
      compressorPromise = null; // let a later upload retry the chunk
      throw err;
    });
  return compressorPromise;
};
import { apiClient, deriveThumbnailKey, getBackendUrl, getAccessToken, getNativeSessionId, uploadsApi } from '../api/apiClient';
import {
  ALLOWED_VIDEO_TYPES,
  MAX_COVERED_IMAGE_SIZE_MB,
  MAX_MEDIA_UPLOAD_SIZE_MB,
  checkUploadFile,
  uploadContextForFolder,
} from '../constants/mediaLimits';
import { generateImagePlaceholder } from './imagePlaceholder';

/**
 * Creates an instantly-available local preview URL for a File/Blob.
 * Returns { url, revoke } — call revoke() once the server asset has painted
 * to avoid leaking the object URL (memory only, never persisted).
 */
export const createLocalPreview = (file) => {
  if (!file || typeof URL === 'undefined' || !URL.createObjectURL) {
    return { url: null, revoke: () => {} };
  }
  const url = URL.createObjectURL(file);
  let revoked = false;
  return {
    url,
    revoke: () => {
      if (revoked) return;
      revoked = true;
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
    },
  };
};

/**
 * Reads intrinsic dimensions of an image File without a full main-thread decode.
 * Prefers createImageBitmap (decoder thread); falls back to a hidden <img>.
 * Never throws — resolves { width, height } or null.
 */
export const getImageDimensions = async (file) => {
  if (!file) return null;
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      const dims = { width: bmp.width, height: bmp.height };
      if (bmp.close) bmp.close();
      return dims;
    } catch (_) { /* fall through */ }
  }
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const dims = { width: img.naturalWidth, height: img.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dims.width && dims.height ? dims : null);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch (_) { resolve(null); }
  });
};

/**
 * Generates a small WebP thumbnail (default longest edge 400px) off the main
 * thread where possible (createImageBitmap + OffscreenCanvas). Returns a
 * { blob, width, height } or null. Skips animated GIFs (returns null so the
 * caller uses the original/first frame handling upstream).
 */
export const generateImageThumbnail = async (file, options = {}) => {
  const { maxSize = 400, quality = 0.7, mimeType = 'image/webp' } = options;
  if (!file || file.type === 'image/gif') return null;

  try {
    if (typeof createImageBitmap !== 'function') return null;
    const bitmap = await createImageBitmap(file);
    const { width: sw, height: sh } = bitmap;
    if (!sw || !sh) { if (bitmap.close) bitmap.close(); return null; }

    const scale = Math.min(1, maxSize / Math.max(sw, sh));
    // Never upscale — tiny images just use themselves.
    const tw = Math.max(1, Math.round(sw * scale));
    const th = Math.max(1, Math.round(sh * scale));

    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(tw, th);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
    }
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, tw, th);
    if (bitmap.close) bitmap.close();

    let blob;
    if (canvas.convertToBlob) {
      blob = await canvas.convertToBlob({ type: mimeType, quality });
    } else {
      blob = await new Promise((res) => canvas.toBlob(res, mimeType, quality));
    }
    if (!blob) return null;
    return { blob, width: tw, height: th };
  } catch (_) {
    return null;
  }
};

/**
 * A clip length in whole seconds, or null when it is not a real length.
 *
 * A MediaRecorder WebM reports `Infinity` until it has been played through,
 * and `Math.round(Infinity) || null` is `Infinity`: it reached the presign
 * request and the database's integer column. A clip shorter than half a second
 * is still a clip, so it rounds up to 1 rather than down to "no duration".
 */
const wholeSeconds = (d) => (Number.isFinite(d) && d > 0 ? Math.max(1, Math.round(d)) : null);

/**
 * Extracts a lightweight poster frame + intrinsic metadata from a video File
 * without downloading/decoding the whole clip. Seeks to ~1s (or midpoint for
 * short clips), draws one frame to a canvas, returns:
 *   { posterBlob, width, height, duration }  (duration in whole seconds)
 * Resolves null on failure so the caller can proceed with just the original.
 *
 * The frame is drawn at most `maxSize` px on its longest edge. It used to be
 * drawn at the clip's full resolution, so a 4K phone video produced a
 * multi-megabyte "thumbnail" that every chat bubble then downloaded. The
 * reported width/height stay the clip's own: they size the bubble.
 *
 * `onMetadata({ width, height, duration })` is called as soon as the clip's
 * metadata is read, before the frame is drawn.
 */
export const generateVideoPoster = async (file, options = {}) => {
  const { quality = 0.75, mimeType = 'image/webp', maxSize = 720, timeoutMs = 4000, onMetadata = null } = options;
  if (!file || !file.type?.startsWith('video/')) return null;

  return new Promise((resolve) => {
    let settled = false;
    let objectUrl = null;
    let timer = null;
    const video = document.createElement('video');
    const metaOnly = () => ({
      posterBlob: null,
      width: video.videoWidth || null,
      height: video.videoHeight || null,
      duration: wholeSeconds(video.duration),
    });
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { video.removeAttribute('src'); video.load(); } catch (_) {}
      if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (_) {} }
      resolve(result);
    };

    try {
      objectUrl = URL.createObjectURL(file);
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      const capture = () => {
        try {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (!vw || !vh) return done(metaOnly());
          const scale = Math.min(1, maxSize / Math.max(vw, vh));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(vw * scale));
          canvas.height = Math.max(1, Math.round(vh * scale));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => done({ ...metaOnly(), posterBlob: blob || null }),
            mimeType,
            quality,
          );
        } catch (_) {
          done(metaOnly());
        }
      };

      video.onloadedmetadata = () => {
        // The size is known here, long before a frame is drawn: callers that
        // lay something out for the clip use it straight away.
        try { onMetadata?.({ width: video.videoWidth || null, height: video.videoHeight || null, duration: wholeSeconds(video.duration) }); } catch (_) { /* caller's problem */ }
        const target = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0;
        try { video.currentTime = target; } catch (_) { capture(); }
      };
      video.onseeked = capture;
      video.onerror = () => done(null);
      // Safety timeout — never hang the send on a stubborn codec.
      timer = setTimeout(() => done(metaOnly()), timeoutMs);

      video.src = objectUrl;
    } catch (_) {
      done(null);
    }
  });
};

/**
 * An upload refused for what the file is, not for how the upload went: too
 * large, empty, or a format that is not stored. Callers show `message` and do
 * not offer a retry, since retrying the same file can only fail again.
 */
export const MEDIA_INVALID = 'MEDIA_INVALID';
const invalidMedia = (message) => Object.assign(new Error(message), { code: MEDIA_INVALID });

/** True for a refusal no retry can fix: invalid media, or the server measuring it as too large. */
export const isMediaRejection = (err) => err?.code === MEDIA_INVALID || err?.status === 413;

/**
 * Validates a file before processing.
 */
export const validateFile = (file, options = {}) => {
  const { maxSizeMB = 10, allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } = options;
  if (!file) {
    throw new Error('No file provided');
  }
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Invalid image format');
  }
  if (file.size > maxSizeMB * 1024 * 1024) {
    throw new Error(`File size limit is ${maxSizeMB} MB`);
  }
  return true;
};

/**
 * Compresses an image file, converting to WebP and stripping EXIF data.
 */
export const compressImage = async (file, options = {}) => {
  const {
    maxWidthOrHeight = 1920,
    initialQuality = 0.8,
    fileType = 'image/webp',
    // The 1 MB target is right for a feed photo and wrong for a document a
    // human has to read. It was hardcoded, so a caller that needed to preserve
    // fine detail — the text on a college ID, a face in a verification selfie —
    // had no way to ask for it and silently got the aggressive setting.
    // Defaulted to 1 so every existing caller is unchanged.
    maxSizeMB = 1,
  } = options;

  // Skip compression for GIFs to preserve animation
  if (!file || file.type === 'image/gif') return file;

  const compressionOptions = {
    maxSizeMB,
    maxWidthOrHeight,
    useWebWorker: true,
    fileType,
    initialQuality,
    exifOrientation: 1, // Reset EXIF
  };

  let imageCompression;
  try {
    imageCompression = await loadCompressor();
  } catch (error) {
    console.warn('Image compressor unavailable, using original file:', error);
    return file;
  }

  try {
    const compressedFile = await imageCompression(file, compressionOptions);
    return compressedFile;
  } catch (error) {
    if (compressionOptions.useWebWorker) {
      try {
        const fallbackCompressed = await imageCompression(file, { ...compressionOptions, useWebWorker: false });
        return fallbackCompressed;
      } catch (fallbackError) {
        console.warn('Fallback image compression failed, using original file:', fallbackError);
      }
    } else {
      console.warn('Image compression failed, using original file:', error);
    }
    return file;
  }
};

/**
 * Wraps an onProgress callback so reported values are clamped to 0-100 and are
 * strictly monotonic. Without this the bar visibly jumps backwards whenever a
 * later stage starts from a lower number, which reads as a stalled/broken upload.
 */
const makeProgressReporter = (onProgress) => {
  let last = 0;
  return (value, phase) => {
    if (typeof onProgress !== 'function') return;
    const v = Math.max(0, Math.min(100, Math.round(value)));
    if (v < last) return;
    last = v;
    onProgress(v, phase);
  };
};

/** Maps a 0-100 sub-progress value into an overall [start,end] band. */
const band = (start, end, pct) => start + ((end - start) * Math.max(0, Math.min(100, pct))) / 100;

/**
 * Requests a presigned URL from the backend and uploads the file.
 * Falls back seamlessly to backend pass-through upload (/api/media/upload) if CORS or network issues block direct upload.
 *
 * `onProgress` reports TRUE byte progress for THIS file on a 0-100 scale, so
 * callers can map it into whatever band of their overall pipeline they want.
 */
/**
 * Set once a direct-to-storage PUT fails at the network level (in practice: the
 * bucket's CORS policy refuses this origin), for the rest of the session.
 *
 * Every upload otherwise paid for a presign, a refused preflight and an
 * orphaned pending row before falling back — twice per image, since the
 * thumbnail is a second upload. The next launch tries the direct path again,
 * so fixing the bucket's CORS takes effect without an app update.
 */
let directUploadBlocked = false;

export const uploadFileDirect = async (file, folder = 'general', onProgress = null, signal = null, variantKey = null, meta = {}) => {
  const report = makeProgressReporter(onProgress);
  try {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
    report(0, 'preparing');

    // Normalize filename extension to match actual MIME type after compression
    const mimeToExt = {
      'image/webp': 'webp',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/webm': 'weba',
      'audio/ogg': 'oga',
      'audio/mp4': 'm4a',
    };
    const fileName = file.name || 'upload';
    const ext = mimeToExt[file.type] || fileName.split('.').pop() || 'bin';
    const baseName = fileName.replace(/\.[^.]+$/, '') || 'file';
    const normalizedName = `${baseName}.${ext}`;

    // 1. Try Direct Upload via Presigned URL
    try {
      if (directUploadBlocked) {
        throw new Error('Direct upload unavailable on this network this session');
      }
      const { uploadUrl, publicUrl, key, mediaId, headers: signedHeaders } = await apiClient.post('/api/media/presigned-url', {
        filename: normalizedName,
        contentType: file.type || 'application/octet-stream',
        folder,
        fileSize: Number(file.size || 0),
        ...(variantKey ? { variantKey } : {}),
        ...(meta?.width ? { width: meta.width } : {}),
        ...(meta?.height ? { height: meta.height } : {}),
        ...(meta?.duration ? { duration: meta.duration } : {}),
        // Blur-up placeholder; an API that predates it ignores the field.
        ...(meta?.placeholder ? { placeholder: meta.placeholder } : {}),
      });

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        // A relative uploadUrl (e.g. `/api/media/direct-upload?key=…`) is OUR
        // backend's dev-fallback endpoint — it must be resolved against the
        // backend origin (not the frontend dev server) and carry the auth token.
        // An absolute uploadUrl is a third-party (R2) presigned URL and must be
        // used verbatim with NO Authorization header (it would break the sig).
        const isRelative = uploadUrl.startsWith('/');
        const resolvedUploadUrl = isRelative
          ? `${getBackendUrl().replace(/\/+$/, '')}${uploadUrl}`
          : uploadUrl;
        xhr.open('PUT', resolvedUploadUrl);
        xhr.withCredentials = isRelative;
        if (isRelative) {
          const token = getAccessToken();
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          // The installed app names its session beside the bearer, as on every
          // other call; without it the guard refuses a bare bearer token.
          const nativeSessionId = getNativeSessionId();
          if (nativeSessionId) xhr.setRequestHeader('x-session-id', nativeSessionId);
        }
        if (file.type) {
          xhr.setRequestHeader('Content-Type', file.type);
        }
        // The headers the URL was signed with, sent verbatim. An older API that
        // does not report them signed the public value for everything.
        const required = signedHeaders && typeof signedHeaders === 'object'
          ? signedHeaders
          : { 'Cache-Control': 'public, max-age=31536000, immutable' };
        for (const [name, value] of Object.entries(required)) {
          if (typeof value === 'string') xhr.setRequestHeader(name, value);
        }

        if (xhr.upload) {
          // True byte progress. Capped at 99 until the server actually ACKs the
          // upload, so the bar never claims 100% while bytes are still in flight.
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0) {
              report(Math.min(99, (e.loaded / e.total) * 100), 'uploading');
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            report(100, 'uploaded');
            resolve(xhr.response);
          } else {
            let errMsg = `Upload failed with status ${xhr.status}`;
            try {
              const errJson = JSON.parse(xhr.responseText);
              if (errJson.error) errMsg = errJson.error;
            } catch (e) {
              // ignore
            }
            reject(new Error(errMsg));
          }
        };

        xhr.onerror = () => {
          // Status 0 with no response: refused before reaching storage.
          directUploadBlocked = true;
          reject(new Error('Network or CORS error during media upload'));
        };
        xhr.onabort = () => reject(new DOMException('Media upload aborted', 'AbortError'));
        if (signal) {
          if (signal.aborted) { try { xhr.abort(); } catch (_) {} }
          signal.addEventListener('abort', () => { try { xhr.abort(); } catch (_) {} }, { once: true });
        }
        xhr.send(file);
      });

      try {
        await apiClient.post('/api/media/confirm', { key });
      } catch (confirmError) {
        // 413: the stored object is over its limit and the server has already
        // deleted it. Anything else is a confirmation that merely did not
        // arrive, and the object is still usable.
        if (confirmError?.status === 413) {
          const tooLarge = new Error(confirmError.message || 'File is too large');
          tooLarge.status = 413;
          throw tooLarge;
        }
        console.warn('Failed to confirm upload with backend, but file is in storage:', confirmError);
      }

      return { publicUrl, key, mediaId };
    } catch (directUploadError) {
      // A deliberate cancel must not silently fall back to a pass-through upload,
      // and neither may a file the server measured and refused: the pass-through
      // would only refuse it again, after uploading every byte a second time.
      if (directUploadError?.name === 'AbortError' || signal?.aborted || directUploadError?.status === 413) {
        throw directUploadError;
      }
      console.warn('Direct presigned upload failed/blocked (e.g. CORS). Retrying with backend pass-through upload:', directUploadError);

      // 2. Fallback: Multipart upload via NestJS backend endpoint (/api/media/upload)
      const formData = new FormData();
      formData.append('file', file, normalizedName);
      formData.append('folder', folder);
      // A thumbnail keeps its derived key, so the UI's `<name>_thumb.webp`
      // finds it. Without this it was stored under a random key and orphaned.
      if (variantKey) formData.append('variantKey', variantKey);
      if (meta?.placeholder) formData.append('placeholder', meta.placeholder);

      // NOTE: apiClient is fetch-based and cannot emit upload progress events,
      // so this pass-through leg is indeterminate by nature. We hold the bar at
      // a steady value while it runs rather than faking movement, then complete.
      report(15, 'uploading');
      const response = await apiClient.post('/api/media/upload', formData, {
        signal: signal || undefined,
      });

      report(100, 'uploaded');
      return response;
    }
  } catch (error) {
    console.error('All media upload methods failed:', error);
    throw error;
  }
};

/**
 * Full image pipeline: Validate -> capture dimensions -> generate thumbnail ->
 * compress original -> upload BOTH (thumbnail + original) directly to storage.
 *
 * Returns { publicUrl, thumbnailUrl, key, thumbnailKey, width, height, mediaId }.
 * The thumbnail is a small WebP (~400px) served in lists/bubbles; the original
 * (<=1920px WebP) is loaded only in the fullscreen viewer. Every step is guarded
 * so a thumbnail failure never blocks the original upload, and all heavy work
 * (decode/resize) runs off the main thread (createImageBitmap + OffscreenCanvas).
 */
// Folders whose images are rendered as small thumbnails in lists/grids/avatars.
// For these we upload a derived `<key>_thumb.webp` variant the UI can request
// instead of the full original (Avatar, feed MediaGrid, etc.).
// Folders whose uploads also get a `<key>_thumb.webp` variant the UI derives
// at render time. Covers were missing from this list, so every profile and
// community cover was served at full size wherever a small one would do.
const DERIVED_THUMB_FOLDERS = [
  'avatars', 'groups', 'communities', 'community-icons',
  'profile-covers', 'community-covers',
  'posts', 'events',
];
const thumbSizeForFolder = (folder) => {
  if (folder === 'avatars' || folder === 'groups' || folder === 'community-icons') return 160;
  // A community icon is painted at 56px on a card and 52px in the campus
  // discover row; 160 covers both on a 3x phone. At 256 the "thumbnail" was
  // within a few hundred bytes of the original and barely worth requesting.
  if (folder === 'communities') return 160;
  if (folder === 'profile-covers' || folder === 'community-covers') return 640;
  // Event posters are only ever listed in a 215-245 CSS px card, so 640 still
  // covers a 3x phone. At 1080 the "thumbnail" came back the same weight as the
  // original portrait upload and the grid was, in effect, unthumbnailed.
  if (folder === 'events') return 640;
  return 1080; // posts
};

export const processAndUploadImage = async (file, folder = 'general', compressOptions = {}, onProgress = null, signal = null, options = {}) => {
  // Overall progress bands (monotonic): the original upload owns the largest
  // slice because it dominates wall-clock time on real connections.
  //   0-10  prepare/compress   10-88 original upload   88-98 thumbnail   100 done
  const report = makeProgressReporter(onProgress);
  // Messages and posts have their own per-file limits; the callers check them
  // before calling, and this repeats it for any path that does not.
  const context = uploadContextForFolder(folder);
  if (context && !options.maxSizeMB) {
    const checked = checkUploadFile(file, context, { expect: 'image' });
    if (!checked.ok) throw invalidMedia(checked.error);
  } else {
    validateFile(file, { maxSizeMB: options.maxSizeMB || MAX_COVERED_IMAGE_SIZE_MB });
  }
  report(2, 'preparing');

  // Two thumbnail strategies:
  //  - 'separate': independent-key thumbnail whose URL is stored by the caller
  //    (chat stores it in the message payload).
  //  - 'derived': a `<originalKey>_thumb.webp` variant the UI derives at render
  //    time — no per-entity storage needed (posts/avatars/covers).
  const withSeparateThumb = options.withThumbnail ?? (folder === 'chat');
  const withDerivedThumb = options.derivedThumbnail ?? (DERIVED_THUMB_FOLDERS.includes(folder));
  const needThumb = withSeparateThumb || withDerivedThumb;

  // Kick off dimensions + (optional) thumbnail + compression in parallel — all
  // off the main thread (createImageBitmap / web worker) so the UI stays smooth.
  // A blur-up placeholder is made for post images only (the one surface that
  // paints it), from the thumbnail where there is one: it decodes far faster
  // than the original. Best-effort; null just means "no blur-up".
  const withPlaceholder = options.placeholder ?? (folder === 'posts');
  const thumbPromise = needThumb
    ? generateImageThumbnail(file, { maxSize: thumbSizeForFolder(folder) }).catch(() => null)
    : Promise.resolve(null);
  const [dims, thumb, compressedFile, placeholder] = await Promise.all([
    getImageDimensions(file).catch(() => null),
    thumbPromise,
    compressImage(file, compressOptions),
    withPlaceholder
      ? thumbPromise.then((t) => generateImagePlaceholder(t?.blob || file)).catch(() => null)
      : Promise.resolve(null),
  ]);
  report(10, 'preparing');

  let thumbnailUrl = null;
  let thumbnailKey = null;
  // What this run has put in storage so far, so a cancel part-way through
  // takes it back out instead of leaving it there with nothing pointing at it.
  const stored = [];

  try {
    // Separate-thumb (chat): upload first so lists can render it ASAP.
    if (withSeparateThumb && thumb?.blob) {
      try {
        const thumbFile = new File([thumb.blob], `thumb.webp`, { type: 'image/webp' });
        const thumbRes = await uploadFileDirect(thumbFile, folder, null, signal);
        thumbnailUrl = thumbRes?.publicUrl || null;
        thumbnailKey = thumbRes?.key || null;
        if (thumbnailKey) stored.push(thumbnailKey);
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        // ignore — original still uploads
      }
    }

    // Original upload occupies 10→88 (or 10→98 when no thumbnail follows).
    const originalEnd = withDerivedThumb && thumb?.blob ? 88 : 98;
    const originalRes = await uploadFileDirect(compressedFile, folder, (percent) => {
      report(band(10, originalEnd, percent), 'uploading');
    }, signal, null, { width: dims?.width, height: dims?.height, placeholder });
    if (originalRes?.key) stored.push(originalRes.key);

    // Derived-thumb: upload to `<originalKey>_thumb.webp` so the UI can render it
    // without the entity storing a second URL. Best-effort — render falls back to
    // the original if it's missing.
    if (withDerivedThumb && thumb?.blob && originalRes?.key) {
      const variantKey = deriveThumbnailKey(originalRes.key);
      if (variantKey) {
        try {
          const thumbFile = new File([thumb.blob], `thumb.webp`, { type: 'image/webp' });
          await uploadFileDirect(thumbFile, folder, (percent) => {
            report(band(88, 98, percent), 'finishing');
          }, signal, variantKey, { width: thumb?.width, height: thumb?.height });
          thumbnailKey = variantKey;
          thumbnailUrl = originalRes.publicUrl ? originalRes.publicUrl.replace(/\.([a-z0-9]+)$/i, '_thumb.webp') : null;
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          // ignore — render falls back to original
        }
      }
    }
    report(100, 'done');

    return {
      ...originalRes,
      thumbnailUrl: thumbnailUrl || originalRes?.publicUrl || null,
      thumbnailKey,
      width: dims?.width || null,
      height: dims?.height || null,
      aspectRatio: dims?.width && dims?.height ? Number((dims.width / dims.height).toFixed(4)) : null,
      placeholder: placeholder || null,
    };
  } catch (err) {
    if (err?.name === 'AbortError') discardStored(stored);
    throw err;
  }
};

/**
 * Removes objects a cancelled upload had already stored. Best-effort: the
 * server only deletes what this account owns and nothing has attached yet, so
 * a key that did get used somewhere is left alone.
 */
function discardStored(keys) {
  for (const key of keys) {
    uploadsApi?.discard?.(key)?.catch?.(() => {});
  }
}

/** Stops a pipeline whose caller has cancelled, between its async steps. */
const throwIfAborted = (signal) => {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
};

/**
 * Full video pipeline: extract poster + metadata client-side (no transcoding),
 * upload the clip, then its small poster as `<key>_thumb.webp`. Returns:
 *   { publicUrl, thumbnailUrl (poster), key, posterKey, width, height, duration, aspectRatio, mediaId }.
 * The original is NOT re-encoded (browser can't transcode cheaply); playback uses
 * range requests via preload="metadata" so the bubble shows instantly.
 *
 * `options.meta` is a poster the caller already made with generateVideoPoster
 * (chat makes it first, to show it in the bubble while the clip uploads), so the
 * clip is not decoded twice. `thumbnailUrl` is null when there is no poster:
 * it is never the clip itself, which an <img> cannot draw.
 */
export const processAndUploadVideo = async (file, folder = 'general', onProgress = null, signal = null, options = {}) => {
  // Validate before any processing so unsupported/oversized clips fail fast with
  // a clear error instead of a broken upload.
  const context = uploadContextForFolder(folder);
  if (context) {
    const checked = checkUploadFile(file, context, { expect: 'video' });
    if (!checked.ok) throw invalidMedia(checked.error);
  } else if (!file || !ALLOWED_VIDEO_TYPES.includes(file.type)) {
    throw invalidMedia('Use an MP4 or WebM video');
  } else if (file.size > MAX_MEDIA_UPLOAD_SIZE_MB * 1024 * 1024) {
    throw invalidMedia(`Video must be ${MAX_MEDIA_UPLOAD_SIZE_MB} MB or less`);
  }
  console.info('[mediaPipeline] video upload start', { name: file.name, type: file.type, size: file.size });
  // Bands: 0-8 poster extraction, 8-90 clip upload, 90-99 poster upload, 100 done.
  const report = makeProgressReporter(onProgress);
  report(2, 'preparing');
  const meta = options.meta !== undefined ? options.meta : await generateVideoPoster(file).catch(() => null);
  throwIfAborted(signal);
  report(8, 'preparing');

  const stored = [];
  try {
    const originalRes = await uploadFileDirect(file, folder, (percent) => {
      report(band(8, 90, percent), 'uploading');
    }, signal, null, { width: meta?.width, height: meta?.height, duration: meta?.duration });
    if (originalRes?.key) stored.push(originalRes.key);

    let thumbnailUrl = null;
    let posterKey = null;

    if (meta?.posterBlob && originalRes?.key) {
      const variantKey = deriveThumbnailKey(originalRes.key);
      if (variantKey) {
        try {
          const posterFile = new File([meta.posterBlob], 'poster.webp', { type: 'image/webp' });
          await uploadFileDirect(posterFile, folder, (percent) => {
            report(band(90, 99, percent), 'finishing');
          }, signal, variantKey, { width: meta?.width, height: meta?.height });
          thumbnailUrl = originalRes.publicUrl ? originalRes.publicUrl.replace(/\.([a-z0-9]+)$/i, '_thumb.webp') : null;
          posterKey = variantKey;
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
        }
      }
    }

    report(100, 'done');

    console.info('[mediaPipeline] video upload done', { key: originalRes?.key, url: originalRes?.publicUrl });
    return {
      ...originalRes,
      thumbnailUrl,
      posterKey,
      width: meta?.width || null,
      height: meta?.height || null,
      duration: meta?.duration || null,
      aspectRatio: meta?.width && meta?.height ? Number((meta.width / meta.height).toFixed(4)) : null,
    };
  } catch (err) {
    if (err?.name === 'AbortError') discardStored(stored);
    throw err;
  }
};

/**
 * Downloads a remote image or GIF URL, compresses it, and uploads it.
 */
export const processAndUploadRemoteUrl = async (url, folder = 'general', compressOptions = {}) => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const contentType = blob.type || (url.includes('.gif') ? 'image/gif' : 'image/jpeg');
    const ext = contentType.includes('gif') ? 'gif' : 'webp';
    const file = new File([blob], `remote-media-${Date.now()}.${ext}`, { type: contentType });
    
    // Skip compression for GIFs to preserve animation if needed
    const compressedFile = await compressImage(file, compressOptions);
    const { publicUrl } = await uploadFileDirect(compressedFile, folder);
    return publicUrl;
  } catch (error) {
    console.warn('Failed to compress remote media, falling back to original URL', error);
    return url;
  }
};
