/**
 * Content inspection for files arriving from unauthenticated callers.
 *
 * The multipart `Content-Type` is supplied by whoever posted the body, so it
 * says nothing about the bytes. These helpers read the actual signature so the
 * two can be compared before anything is stored.
 */

/** Leading byte signatures for the types the support form accepts. */
const SIGNATURES: Array<{ mime: string; offset: number; bytes: number[] }> = [
  { mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  {
    mime: 'image/png',
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: 'image/gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

/**
 * Returns the mimetype implied by the file's own contents, or null when the
 * signature matches nothing known.
 */
export function sniffMimeType(buffer: Buffer): string | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  for (const { mime, offset, bytes } of SIGNATURES) {
    if (bytes.every((byte, i) => buffer[offset + i] === byte)) return mime;
  }

  // WEBP is a RIFF container: "RIFF" .... "WEBP". Checking only "RIFF" would
  // also match WAV and AVI, so both halves are required.
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

/** True when the bytes begin like one of the video containers uploads use. */
function hasVideoSignature(buffer: Buffer): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  // ISO base media: MP4, and QuickTime written under an .mp4 name.
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return true;
  // EBML header: WebM / Matroska.
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return true;
  }
  return buffer.subarray(0, 4).toString('ascii') === 'OggS';
}

/**
 * Whether an upload's bytes are the KIND its declared type names: an image
 * that is an image, a video that is a video.
 *
 * Kinds rather than exact types on purpose. A client re-encodes photos, and a
 * label that lags its bytes (a PNG named `.jpg`) still renders everywhere; a
 * non-media file labelled as one does not, and is what this refuses. Audio has
 * no check here: voice notes come from the recorder in containers that share no
 * single signature.
 */
export function contentMatchesDeclaredKind(
  buffer: Buffer,
  mimetype: string,
): boolean {
  const type = (mimetype || '').toLowerCase();
  if (type.startsWith('image/')) {
    return sniffMimeType(buffer)?.startsWith('image/') ?? false;
  }
  if (type.startsWith('video/')) return hasVideoSignature(buffer);
  return true;
}

/**
 * Reduces an uploaded file's name to something safe to store in JSON and show
 * in the admin UI. The name is display-only - the stored object key is
 * generated server-side and never derived from this - but it still travels
 * into an admin's browser, so directory traversal and control characters go.
 */
export function sanitizeFilename(original: string): string {
  const base = String(original ?? 'attachment')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .trim();

  return (base || 'attachment').slice(0, 120);
}
