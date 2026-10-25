/**
 * Centralized upload size and media configuration limits for backend.
 */

/** Maximum allowed file size for covered image uploads: 10 MB (10 * 1024 * 1024 bytes) */
export const MAX_COVERED_IMAGE_SIZE_MB = 10;
export const MAX_COVERED_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Ceiling for uploads with no tighter rule of their own (voice notes,
 * `general`). Message and post media have per-file limits: see
 * {@link uploadLimitFor}.
 */
export const MAX_MEDIA_UPLOAD_SIZE_MB = 50;
export const MAX_MEDIA_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

const MB = 1024 * 1024;

/**
 * Per-file limits for the two places people attach media, by kind. Each file
 * is measured on its own, never the total of a message or a post.
 *
 * Mirrored by `frontend/src/shared/constants/mediaLimits.js` (UPLOAD_LIMITS),
 * which refuses an oversized file before uploading any of it. These are the
 * ones that hold: every path that can put bytes into storage checks them.
 */
export const MESSAGE_MEDIA_LIMITS = { video: 15 * MB, image: 5 * MB } as const;
export const POST_MEDIA_LIMITS = { video: 25 * MB, image: 5 * MB } as const;
/** One voice note. A five-minute recording is a few MB; this is the ceiling. */
export const VOICE_NOTE_MAX_BYTES = 15 * MB;

/** Folders whose uploads are message attachments. */
const MESSAGE_FOLDERS = new Set(['chat', 'messages']);
/** Folders a voice note can be stored in. */
const VOICE_FOLDERS = new Set(['voice', 'chat', 'messages']);

export interface UploadLimit {
  maxBytes: number;
  /** What to tell the person when a file is over it. */
  message: string;
}

/**
 * The most bytes one file may have, for a folder and content type.
 *
 * Message and post media get their own limit per kind, voice notes theirs;
 * every other folder keeps the general ceiling, and covered images keep theirs.
 */
export function uploadLimitFor(
  folder: string,
  contentType: string | undefined,
): UploadLimit {
  const normalized = (folder || '').trim().toLowerCase();
  if (isCoveredImageFolder(normalized)) {
    return {
      maxBytes: MAX_COVERED_IMAGE_SIZE_BYTES,
      message: COVERED_IMAGE_SIZE_ERROR_MESSAGE,
    };
  }
  const type = (contentType || '').toLowerCase();
  if (type.startsWith('audio/') && VOICE_FOLDERS.has(normalized)) {
    return {
      maxBytes: VOICE_NOTE_MAX_BYTES,
      message: 'Voice note must be 15 MB or less',
    };
  }
  const kind = type.startsWith('video/')
    ? 'video'
    : type.startsWith('image/')
      ? 'image'
      : null;
  const table = MESSAGE_FOLDERS.has(normalized)
    ? MESSAGE_MEDIA_LIMITS
    : normalized === 'posts'
      ? POST_MEDIA_LIMITS
      : null;
  if (table && kind) {
    const maxBytes = table[kind];
    const noun = kind === 'video' ? 'Video' : 'Image';
    return {
      maxBytes,
      message: `${noun} must be ${Math.round(maxBytes / MB)} MB or less`,
    };
  }
  return {
    maxBytes: MAX_MEDIA_UPLOAD_SIZE_BYTES,
    message: 'File is too large',
  };
}

/**
 * Storage folder prefixes classified as covered avatar, cover, banner, or thumbnail image types.
 * Any upload targeting these folders is strictly restricted to MAX_COVERED_IMAGE_SIZE_BYTES (10 MB).
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
] as const;

export type CoveredImageFolder = (typeof COVERED_IMAGE_FOLDERS)[number];

export const COVERED_IMAGE_SIZE_ERROR_MESSAGE = 'File size limit is 10 MB';

/**
 * Checks whether a given storage folder prefix is subject to the 10 MB covered image upload limit.
 */
export function isCoveredImageFolder(folder: string): boolean {
  if (!folder || typeof folder !== 'string') return false;
  const normalized = folder.trim().toLowerCase();
  return (COVERED_IMAGE_FOLDERS as readonly string[]).includes(normalized);
}
