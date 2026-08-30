import { compressImage, getImageDimensions } from './mediaPipeline';
import {
  VERIFICATION_ALLOWED_TYPES,
  VERIFICATION_MAX_UPLOAD_MB,
  VERIFICATION_COMPRESS_OPTIONS,
  VERIFICATION_MIN_DIMENSION,
} from '../constants/mediaLimits';

/**
 * The account-verification document pipeline.
 *
 * Verification used to hand the raw picked file straight to `uploadMedia`,
 * skipping the processing every other image in the app goes through. The
 * consequences were visible in production data: verification objects were the
 * only `image/jpeg` rows in a table that is otherwise 87% WebP, they carried no
 * recorded dimensions, they averaged 871 KB against 302 KB for post images, and
 * — because nothing resampled them through a canvas — a college ID photographed
 * on a phone arrived with its original EXIF block intact, GPS tags and all.
 *
 * This module is deliberately separate from `processAndUploadImage` for one
 * reason: that function uploads through a presigned URL straight to storage, so
 * the server never sees the bytes and cannot check that a file claiming to be a
 * JPEG actually is one. Identity documents go through the pass-through endpoint
 * instead, where the server verifies the magic number against the declared type.
 * Verification volume is tiny, so the extra hop costs nothing that matters.
 */

/** A validation failure that names which of the two documents is at fault. */
export class VerificationDocumentError extends Error {
  constructor(label, message) {
    super(message);
    this.name = 'VerificationDocumentError';
    this.label = label;
  }
}

/**
 * Checks a picked file before any work is done on it.
 *
 * Every message names the document, because "Invalid image format" on a form
 * with two file inputs does not tell the user which one to replace.
 */
export async function validateVerificationDocument(file, label) {
  if (!file) {
    throw new VerificationDocumentError(label, `Please provide your ${label}.`);
  }
  if (!VERIFICATION_ALLOWED_TYPES.includes(file.type)) {
    throw new VerificationDocumentError(
      label,
      `Your ${label} must be a JPEG, PNG or WebP image.`,
    );
  }
  if (file.size > VERIFICATION_MAX_UPLOAD_MB * 1024 * 1024) {
    throw new VerificationDocumentError(
      label,
      `Your ${label} is too large. The limit is ${VERIFICATION_MAX_UPLOAD_MB} MB.`,
    );
  }

  // Decoding the image is also the corruption check: a truncated or malformed
  // file fails to load here rather than reaching a reviewer as a broken frame.
  let dimensions;
  try {
    dimensions = await getImageDimensions(file);
  } catch {
    throw new VerificationDocumentError(
      label,
      `Your ${label} could not be read. Please choose a different image.`,
    );
  }

  const shortestEdge = Math.min(dimensions?.width || 0, dimensions?.height || 0);
  if (!shortestEdge) {
    throw new VerificationDocumentError(
      label,
      `Your ${label} could not be read. Please choose a different image.`,
    );
  }
  if (shortestEdge < VERIFICATION_MIN_DIMENSION) {
    throw new VerificationDocumentError(
      label,
      `Your ${label} is too small to review. Please use an image at least ${VERIFICATION_MIN_DIMENSION} pixels on its shortest side.`,
    );
  }

  return dimensions;
}

/**
 * Validates, then converts to WebP at a quality that keeps a document readable.
 *
 * `compressImage` resets EXIF orientation as it resamples, which both strips the
 * metadata a phone photo carries and bakes the correct rotation into the pixels
 * — so an ID shot in portrait no longer reaches the reviewer sideways.
 *
 * If compression fails it returns the original file rather than throwing; that
 * is its documented behaviour and the right call here too, since a slightly
 * larger original is far better than a blocked verification. The server still
 * validates whatever actually arrives.
 */
export async function prepareVerificationDocument(file, label) {
  await validateVerificationDocument(file, label);

  const processed = await compressImage(file, VERIFICATION_COMPRESS_OPTIONS);
  const type = processed.type || file.type;
  const extension = type === 'image/webp' ? 'webp' : 'jpg';
  const name = `verification-${label.replace(/\s+/g, '-')}.${extension}`;

  // Re-wrapped as a File so the name and type the server records match the
  // bytes it actually receives — the server derives the stored extension from
  // the declared mimetype and checks the magic number against it, so the two
  // must not disagree.
  return new File([processed], name, { type, lastModified: Date.now() });
}

/**
 * Reads the media id out of an upload response.
 *
 * The endpoint returns `{ publicUrl, key, mediaId, media }` — there is no
 * top-level `id`. The submission code read `res.id`, so both ids came out
 * `undefined` and `JSON.stringify` dropped the keys entirely: the request that
 * reached the server was an empty object. Resolving it in one place, and
 * throwing rather than returning undefined, means that failure cannot happen
 * silently again.
 */
export function readUploadedMediaId(res, label) {
  const id = res?.mediaId || res?.media?.id || res?.id;
  if (!id) {
    throw new VerificationDocumentError(
      label,
      `Your ${label} could not be uploaded. Please try again.`,
    );
  }
  return id;
}
