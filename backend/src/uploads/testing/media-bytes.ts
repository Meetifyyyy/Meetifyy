/**
 * The first bytes of real files, for specs whose upload path now checks that a
 * message or post upload's contents are the kind its type claims
 * (`contentMatchesDeclaredKind`). Padded past the 12 bytes the sniffers read.
 */
const pad = (head: number[]): Buffer =>
  Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);

/** "RIFF" <size> "WEBP" */
export const WEBP_BYTES = pad([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);

export const PNG_BYTES = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** <box size> "ftyp" "isom" — an MP4. */
export const MP4_BYTES = pad([
  0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

/** EBML header — WebM. */
export const WEBM_BYTES = pad([0x1a, 0x45, 0xdf, 0xa3]);
