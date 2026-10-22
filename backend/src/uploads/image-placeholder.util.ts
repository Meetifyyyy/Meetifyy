/**
 * The low-quality image placeholder (LQIP) a post image carries so the feed can
 * paint a blurred stand-in while the real file loads.
 *
 * The client downsizes the picture to a ~16px WebP/JPEG while it is already
 * compressing it and sends the result as a `data:` URL beside the width and
 * height. The string is later written into a CSS `url()` in every viewer's
 * browser, so it is treated as hostile: only a base64 WebP or JPEG whose
 * decoded bytes really start with that format's signature is accepted, and the
 * whole string is capped far below anything an image of this size needs.
 *
 * It is cosmetic. Anything that fails validation becomes `null` (no
 * placeholder) and never fails the upload that carried it.
 */

import sharp from 'sharp';

/** Longest accepted string, in characters. A 16px WebP is ~150-400. */
export const IMAGE_PLACEHOLDER_MAX_CHARS = 1500;

const DATA_URL = /^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

function hasSignature(kind: 'webp' | 'jpeg', bytes: Buffer): boolean {
  if (kind === 'jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  // RIFF <4 bytes of size> WEBP
  return (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  );
}

/** Longest edge, in pixels, of a placeholder. The client sends ~16px. */
export const IMAGE_PLACEHOLDER_MAX_EDGE = 64;

/**
 * The placeholder if `input` is well-formed by SHAPE (a data URL, a base64
 * payload with the right file signature, within the length cap), otherwise
 * null. Never throws, whatever it is given.
 *
 * Synchronous and cheap, so it is what the read side uses. Anything arriving
 * from a client goes through `parseImagePlaceholder`, which also decodes it.
 */
export function parseImagePlaceholderShape(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  if (input.length > IMAGE_PLACEHOLDER_MAX_CHARS) return null;
  const match = DATA_URL.exec(input);
  if (!match) return null;
  const [, kind, base64] = match;
  if (base64.length % 4 !== 0) return null;
  const bytes = Buffer.from(base64, 'base64');
  // A real image has headers and at least one block of data.
  if (bytes.length < 16) return null;
  return hasSignature(kind as 'webp' | 'jpeg', bytes) ? input : null;
}

/**
 * The placeholder if it is well-formed AND decodes as a real image of the
 * declared type, at most 64px on each side, otherwise null. Never throws.
 *
 * A signature proves only the first bytes. Decoding it here means what gets
 * stored is a genuine tiny image, not a few valid bytes followed by anything,
 * and the pixel limit stops a small file that declares a huge canvas.
 */
export async function parseImagePlaceholder(
  input: unknown,
): Promise<string | null> {
  const shaped = parseImagePlaceholderShape(input);
  if (!shaped) return null;
  try {
    const [, kind, base64] = DATA_URL.exec(shaped)!;
    const bytes = Buffer.from(base64, 'base64');
    const maxPixels = IMAGE_PLACEHOLDER_MAX_EDGE * IMAGE_PLACEHOLDER_MAX_EDGE;
    const meta = await sharp(bytes, { limitInputPixels: maxPixels }).metadata();
    if (meta.format !== kind) return null;
    const { width, height } = meta;
    if (
      !width ||
      !height ||
      width > IMAGE_PLACEHOLDER_MAX_EDGE ||
      height > IMAGE_PLACEHOLDER_MAX_EDGE
    ) {
      return null;
    }
    // A full decode: a truncated or corrupt payload throws here.
    await sharp(bytes, { limitInputPixels: maxPixels }).raw().toBuffer();
    return shaped;
  } catch {
    return null;
  }
}

/**
 * Reads `Media.placeholder` back. It was validated on write too; checking it
 * again means a value that reached the column any other way never gets into a
 * CSS `url()` on a client.
 */
export function readStoredImagePlaceholder(
  stored: string | null | undefined,
): string | null {
  return stored ? parseImagePlaceholderShape(stored) : null;
}
