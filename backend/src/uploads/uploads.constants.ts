/**
 * Centralized upload size and media configuration limits for backend.
 */

/** Maximum allowed file size for covered image uploads: 10 MB (10 * 1024 * 1024 bytes) */
export const MAX_COVERED_IMAGE_SIZE_MB = 10;
export const MAX_COVERED_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum allowed file size for general/post/chat media uploads: 50 MB */
export const MAX_MEDIA_UPLOAD_SIZE_MB = 50;
export const MAX_MEDIA_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

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
