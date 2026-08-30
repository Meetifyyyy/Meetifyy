/**
 * Centralized media upload size limits and validation constants.
 */

/** Maximum allowed file size for covered image uploads: 10 MB (10 * 1024 * 1024 bytes) */
export const MAX_COVERED_IMAGE_SIZE_MB = 10;
export const MAX_COVERED_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10,485,760 bytes

/** Maximum allowed file size for general/post/chat media uploads: 50 MB */
export const MAX_MEDIA_UPLOAD_SIZE_MB = 50;
export const MAX_MEDIA_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

export const COVERED_IMAGE_SIZE_ERROR_MESSAGE = 'File size limit is 10 MB';

/** Allowed file accept strings for native file picker dialogs */
export const ALLOWED_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';
export const ALLOWED_MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov';

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
