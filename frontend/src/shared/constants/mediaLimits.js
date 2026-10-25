/**
 * Centralized media upload size limits and validation constants.
 */

/** Maximum allowed file size for covered image uploads: 10 MB (10 * 1024 * 1024 bytes) */
export const MAX_COVERED_IMAGE_SIZE_MB = 10;
export const MAX_COVERED_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10,485,760 bytes

/**
 * Ceiling for uploads with no limit of their own (voice notes, `general`).
 * Messages and posts have tighter per-file limits: see UPLOAD_LIMITS.
 */
export const MAX_MEDIA_UPLOAD_SIZE_MB = 50;
export const MAX_MEDIA_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

export const COVERED_IMAGE_SIZE_ERROR_MESSAGE = 'File size limit is 10 MB';

/** Allowed file accept strings for native file picker dialogs */
/** Image MIME types the upload pipeline accepts (validateFile). */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Video MIME types the upload pipeline accepts. The server stores nothing
 * else, so a picker that offers `.mov` still has to refuse it here rather than
 * let it fail halfway through an upload.
 */
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];

const MB = 1024 * 1024;

/**
 * Per-file limits for the two places people attach media. Each file is checked
 * on its own: four 5 MB photos in one post are fine, one 6 MB photo is not.
 *
 * Mirrored by `backend/src/uploads/uploads.constants.ts`, which enforces the
 * same numbers on every path that can put bytes into storage. This copy only
 * exists so an oversized file is refused before any of it is uploaded.
 */
export const UPLOAD_LIMITS = Object.freeze({
  message: Object.freeze({ video: 15 * MB, image: 5 * MB }),
  post: Object.freeze({ video: 25 * MB, image: 5 * MB }),
});

/** One voice note, mirrored by VOICE_NOTE_MAX_BYTES on the server. */
export const VOICE_NOTE_MAX_BYTES = 15 * MB;
export const VOICE_NOTE_SIZE_MESSAGE = 'Voice note must be 15 MB or less';

/** The longest a voice note may be recorded for. */
export const VOICE_NOTE_MAX_MS = 5 * 60 * 1000;

/** Which UPLOAD_LIMITS context a storage folder belongs to, or null. */
export function uploadContextForFolder(folder) {
  if (folder === 'chat' || folder === 'messages') return 'message';
  if (folder === 'posts') return 'post';
  return null;
}

/** "Video must be 15 MB or less". The same words the server answers with. */
export function uploadSizeMessage(kind, maxBytes) {
  const noun = kind === 'video' ? 'Video' : 'Image';
  return `${noun} must be ${Math.round(maxBytes / MB)} MB or less`;
}

function kindOfType(type) {
  if (typeof type !== 'string') return null;
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return null;
}

/**
 * The checks that need nothing but the File object: present, not empty, a type
 * the pipeline stores, and within the limit for `context`.
 *
 * `expect` narrows a picker that is only for one kind ("image" or "video").
 * Returns `{ ok: true, kind }` or `{ ok: false, error }`, where `error` is the
 * short message to show the person.
 */
export function checkUploadFile(file, context, { expect } = {}) {
  if (!file) return { ok: false, error: 'No file selected' };
  const kind = kindOfType(file.type);
  if (expect && kind !== expect) {
    return { ok: false, error: expect === 'video' ? 'Choose a video' : 'Choose an image' };
  }
  if (kind === 'video' && !ALLOWED_VIDEO_TYPES.includes(file.type)) {
    return { ok: false, error: 'Use an MP4 or WebM video' };
  }
  if (kind === 'image' && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: 'Unsupported image format' };
  }
  if (!kind) return { ok: false, error: 'Unsupported file type' };
  if (!(file.size > 0)) return { ok: false, error: 'This file is empty' };
  const limits = UPLOAD_LIMITS[context];
  if (limits && file.size > limits[kind]) {
    return { ok: false, error: uploadSizeMessage(kind, limits[kind]) };
  }
  return { ok: true, kind };
}

async function readHead(file, length) {
  const head = file.slice(0, length);
  if (typeof head.arrayBuffer === 'function') return new Uint8Array(await head.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(head);
  });
}

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to));

/**
 * What the file's own first bytes say it is: 'image', 'video', or null.
 *
 * `file.type` comes from the name (or the gallery's guess), so a renamed file
 * passes it. The signatures are the ones the pipeline's formats begin with.
 */
export function sniffMediaKind(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return 'image';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'image';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image';
  // ISO base media (MP4, and QuickTime written with an .mp4 name).
  if (ascii(bytes, 4, 8) === 'ftyp') return 'video';
  // EBML header: WebM / Matroska.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video';
  if (ascii(bytes, 0, 4) === 'OggS') return 'video';
  return null;
}

/**
 * `checkUploadFile`, then a look at the bytes. A file whose contents are not
 * the kind its type claims is refused before upload. A file that cannot be
 * read at all is left to the upload to report: refusing on a failed read
 * would block real files on a browser without Blob reading.
 */
export async function validateUploadFile(file, context, options = {}) {
  const result = checkUploadFile(file, context, options);
  if (!result.ok) return result;
  let bytes;
  try {
    bytes = await readHead(file, 16);
  } catch {
    return result;
  }
  if (sniffMediaKind(bytes) !== result.kind) return { ok: false, error: "Couldn't read this file" };
  return result;
}

export const ALLOWED_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';
/*
 * No `.mov` / `video/quicktime`: neither the pipeline nor the server stores
 * it, so offering it in the picker only led to a file refused after picking.
 */
export const ALLOWED_VIDEO_ACCEPT = 'video/mp4,video/webm,video/ogg,.mp4,.webm,.ogv';
export const ALLOWED_MEDIA_ACCEPT = `${ALLOWED_IMAGE_ACCEPT},${ALLOWED_VIDEO_ACCEPT}`;

/**
 * Storage folder prefixes classified as covered avatar, cover, banner, or thumbnail image types.
 */
export const COVERED_IMAGE_FOLDERS = [
  'avatars',
  'profile-covers',
  'communities',
  'community-icons',
  'community-covers',
  'groups',
  'events',
  'activities',
];

/**
 * Checks whether a given storage folder prefix is subject to the 10 MB covered image upload limit.
 */
export function isCoveredImageFolder(folder) {
  if (!folder || typeof folder !== 'string') return false;
  return COVERED_IMAGE_FOLDERS.includes(folder.trim().toLowerCase());
}

/**
 * Validates whether a file meets the 10 MB covered image size requirement.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateCoveredImageFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }
  if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
    return { valid: false, error: COVERED_IMAGE_SIZE_ERROR_MESSAGE };
  }
  return { valid: true };
}

// ── Account verification documents ───────────────────────────────────────────
//
// Verification images are held to different rules than ordinary media, in both
// directions. They are stricter about what is accepted — a document has to be a
// still image the server can verify the bytes of, so animated GIF is out — and
// deliberately *looser* about compression, because a reviewer has to read the
// text on a college ID and recognise a face in a selfie. The generic post
// settings (1920px, quality 0.8, 1 MB target) are tuned for a feed photo and
// throw away exactly the detail an identity decision depends on.

/** Formats accepted for a verification document. Mirrors the server allowlist. */
export const VERIFICATION_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Ceiling on the file a user may pick, before processing. */
export const VERIFICATION_MAX_UPLOAD_MB = 25;

/**
 * Processing options for verification documents.
 *
 * Tuned for legibility over file size, which is the opposite of every other
 * image in the app. A reviewer has to read the small print on a college ID and
 * recognise a face in a selfie, so these documents are converted to WebP —
 * which also strips EXIF and normalises orientation — and otherwise left as
 * close to the original as the encoder allows. 3200px keeps detail on an ID
 * photographed at arm's length, and the 12 MB ceiling exists only to stop a
 * pathological file, not to shrink a normal one.
 */
export const VERIFICATION_COMPRESS_OPTIONS = {
  maxWidthOrHeight: 3200,
  initialQuality: 0.95,
  maxSizeMB: 12,
  fileType: 'image/webp',
};

/** Shortest edge we will accept — below this an ID is not reviewable. */
export const VERIFICATION_MIN_DIMENSION = 320;

/** The two documents a submission is made of, in payload order. */
export const VERIFICATION_DOCUMENTS = {
  selfie: { field: 'selfieMediaId', label: 'selfie' },
  collegeId: { field: 'idCardMediaId', label: 'college ID' },
};
