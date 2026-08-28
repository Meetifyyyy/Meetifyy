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
