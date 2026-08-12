import imageCompression from 'browser-image-compression';
import { apiClient, deriveThumbnailKey } from '../api/apiClient';

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
 * Extracts a lightweight poster frame + intrinsic metadata from a video File
 * without downloading/decoding the whole clip. Seeks to ~1s (or midpoint for
 * short clips), draws one frame to a canvas, returns:
 *   { posterBlob, width, height, duration }  (duration in whole seconds)
 * Resolves null on failure so the caller can proceed with just the original.
 */
export const generateVideoPoster = async (file, options = {}) => {
  const { quality = 0.7, mimeType = 'image/webp' } = options;
  if (!file || !file.type?.startsWith('video/')) return null;

  return new Promise((resolve) => {
    let settled = false;
    let objectUrl = null;
    const video = document.createElement('video');
    const done = (result) => {
      if (settled) return;
      settled = true;
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
          if (!vw || !vh) return done({ posterBlob: null, width: null, height: null, duration: Math.round(video.duration) || null });
          const canvas = document.createElement('canvas');
          canvas.width = vw;
          canvas.height = vh;
          canvas.getContext('2d').drawImage(video, 0, 0, vw, vh);
          canvas.toBlob(
            (blob) => done({
              posterBlob: blob,
              width: vw,
              height: vh,
              duration: Number.isFinite(video.duration) ? Math.round(video.duration) : null,
            }),
            mimeType,
            quality,
          );
        } catch (_) {
          done({ posterBlob: null, width: video.videoWidth || null, height: video.videoHeight || null, duration: Math.round(video.duration) || null });
        }
      };

      video.onloadedmetadata = () => {
        const target = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0;
        try { video.currentTime = target; } catch (_) { capture(); }
      };
      video.onseeked = capture;
      video.onerror = () => done(null);
      // Safety timeout — never hang the send on a stubborn codec.
      setTimeout(() => done({ posterBlob: null, width: video.videoWidth || null, height: video.videoHeight || null, duration: Math.round(video.duration) || null }), 4000);

      video.src = objectUrl;
    } catch (_) {
      done(null);
    }
  });
};

/**
 * Validates a file before processing.
 */
export const validateFile = (file, options = {}) => {
  const { maxSizeMB = 10, allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } = options;
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`);
  }
  if (file.size / 1024 / 1024 > maxSizeMB) {
    throw new Error(`File is too large. Max size is ${maxSizeMB}MB.`);
  }
  return true;
};

/**
 * Compresses an image file, converting to WebP and stripping EXIF data.
 */
export const compressImage = async (file, options = {}) => {
  const { maxWidthOrHeight = 1920, initialQuality = 0.8, fileType = 'image/webp' } = options;
  
  // Skip compression for GIFs to preserve animation
  if (!file || file.type === 'image/gif') return file;

  const compressionOptions = {
    maxSizeMB: 1, // Target max size (aggressive)
    maxWidthOrHeight,
    useWebWorker: true,
    fileType,
    initialQuality,
    exifOrientation: 1, // Reset EXIF
  };

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
 * Requests a presigned URL from the backend and uploads the file.
 * Falls back seamlessly to backend pass-through upload (/api/media/upload) if CORS or network issues block direct upload.
 */
export const uploadFileDirect = async (file, folder = 'general', onProgress = null, signal = null, variantKey = null) => {
  try {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
    if (onProgress) onProgress(10);

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
    };
    const fileName = file.name || 'upload';
    const ext = mimeToExt[file.type] || fileName.split('.').pop() || 'bin';
    const baseName = fileName.replace(/\.[^.]+$/, '') || 'file';
    const normalizedName = `${baseName}.${ext}`;

    // 1. Try Direct Upload via Presigned URL
    try {
      const { uploadUrl, publicUrl, key, mediaId } = await apiClient.post('/api/media/presigned-url', {
        filename: normalizedName,
        contentType: file.type || 'application/octet-stream',
        folder,
        fileSize: Number(file.size || 0),
        ...(variantKey ? { variantKey } : {}),
      });

      if (onProgress) onProgress(20);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.withCredentials = uploadUrl.startsWith('/');
        if (file.type) {
          xhr.setRequestHeader('Content-Type', file.type);
        }
        xhr.setRequestHeader('Cache-Control', 'public, max-age=31536000, immutable');

        if (onProgress && xhr.upload) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0) {
              const xhrPercent = Math.round((e.loaded / e.total) * 100);
              const overallPercent = Math.min(99, 20 + Math.round((xhrPercent * 79) / 100));
              onProgress(overallPercent);
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (onProgress) onProgress(100);
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

        xhr.onerror = () => reject(new Error('Network or CORS error during media upload'));
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
        console.warn('Failed to confirm upload with backend, but file is in storage:', confirmError);
      }

      return { publicUrl, key, mediaId };
    } catch (directUploadError) {
      // A deliberate cancel must not silently fall back to a pass-through upload.
      if (directUploadError?.name === 'AbortError' || signal?.aborted) {
        throw directUploadError;
      }
      console.warn('Direct presigned upload failed/blocked (e.g. CORS). Retrying with backend pass-through upload:', directUploadError);

      // 2. Fallback: Multipart upload via NestJS backend endpoint (/api/media/upload)
      const formData = new FormData();
      formData.append('file', file, normalizedName);
      formData.append('folder', folder);

      const response = await apiClient.post('/api/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: signal || undefined,
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
            onProgress(percent);
          }
        },
      });

      if (onProgress) onProgress(100);
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
const DERIVED_THUMB_FOLDERS = ['avatars', 'groups', 'communities', 'posts', 'events'];
const thumbSizeForFolder = (folder) => {
  if (folder === 'avatars' || folder === 'groups') return 160;
  if (folder === 'communities') return 256;
  return 480; // posts
};

export const processAndUploadImage = async (file, folder = 'general', compressOptions = {}, onProgress = null, signal = null, options = {}) => {
  validateFile(file);
  if (onProgress) onProgress(6);

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
  const [dims, thumb, compressedFile] = await Promise.all([
    getImageDimensions(file).catch(() => null),
    needThumb ? generateImageThumbnail(file, { maxSize: thumbSizeForFolder(folder) }).catch(() => null) : Promise.resolve(null),
    compressImage(file, compressOptions),
  ]);
  if (onProgress) onProgress(20);

  let thumbnailUrl = null;
  let thumbnailKey = null;

  // Separate-thumb (chat): upload first so lists can render it ASAP.
  if (withSeparateThumb && thumb?.blob) {
    try {
      const thumbFile = new File([thumb.blob], `thumb.webp`, { type: 'image/webp' });
      const thumbRes = await uploadFileDirect(thumbFile, folder, null, signal);
      thumbnailUrl = thumbRes?.publicUrl || null;
      thumbnailKey = thumbRes?.key || null;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // ignore — original still uploads
    }
  }

  const originalRes = await uploadFileDirect(compressedFile, folder, (percent) => {
    if (onProgress) {
      const overallPercent = Math.min(needThumb && withDerivedThumb ? 92 : 100, 25 + Math.round((percent * 75) / 100));
      onProgress(overallPercent);
    }
  }, signal);

  // Derived-thumb: upload to `<originalKey>_thumb.webp` so the UI can render it
  // without the entity storing a second URL. Best-effort — render falls back to
  // the original if it's missing.
  if (withDerivedThumb && thumb?.blob && originalRes?.key) {
    const variantKey = deriveThumbnailKey(originalRes.key);
    if (variantKey) {
      try {
        const thumbFile = new File([thumb.blob], `thumb.webp`, { type: 'image/webp' });
        await uploadFileDirect(thumbFile, folder, null, signal, variantKey);
        thumbnailKey = variantKey;
        thumbnailUrl = originalRes.publicUrl ? originalRes.publicUrl.replace(/\.([a-z0-9]+)$/i, '_thumb.webp') : null;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        // ignore — render falls back to original
      }
    }
  }
  if (onProgress) onProgress(100);

  return {
    ...originalRes,
    thumbnailUrl: thumbnailUrl || originalRes?.publicUrl || null,
    thumbnailKey,
    width: dims?.width || null,
    height: dims?.height || null,
  };
};

/**
 * Full video pipeline: extract poster + metadata client-side (no transcoding),
 * upload the small poster then the original clip. Returns:
 *   { publicUrl, thumbnailUrl (poster), key, posterKey, width, height, duration, mediaId }.
 * The original is NOT re-encoded (browser can't transcode cheaply); playback uses
 * range requests via preload="metadata" so the bubble shows instantly.
 */
export const processAndUploadVideo = async (file, folder = 'general', onProgress = null, signal = null) => {
  if (onProgress) onProgress(4);
  const meta = await generateVideoPoster(file).catch(() => null);
  if (onProgress) onProgress(12);

  let thumbnailUrl = null;
  let posterKey = null;
  if (meta?.posterBlob) {
    try {
      const posterFile = new File([meta.posterBlob], 'poster.webp', { type: 'image/webp' });
      const posterRes = await uploadFileDirect(posterFile, folder, null, signal);
      thumbnailUrl = posterRes?.publicUrl || null;
      posterKey = posterRes?.key || null;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
  }

  const originalRes = await uploadFileDirect(file, folder, (percent) => {
    if (onProgress) {
      const overallPercent = Math.min(100, 15 + Math.round((percent * 85) / 100));
      onProgress(overallPercent);
    }
  }, signal);

  return {
    ...originalRes,
    thumbnailUrl,
    posterKey,
    width: meta?.width || null,
    height: meta?.height || null,
    duration: meta?.duration || null,
  };
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
