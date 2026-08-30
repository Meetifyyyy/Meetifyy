import { describe, it, expect } from 'vitest';
import {
  readUploadedMediaId,
  VerificationDocumentError,
} from '../verificationMedia';
import {
  VERIFICATION_ALLOWED_TYPES,
  VERIFICATION_COMPRESS_OPTIONS,
} from '../../constants/mediaLimits';

/**
 * `POST /api/media/upload` returns `{ publicUrl, key, mediaId, media }` — there
 * is no top-level `id`. The submission code read `res.id`, so both media ids
 * came out `undefined`, `JSON.stringify` dropped the keys, and the request that
 * reached the server was an empty object `{}`. The live database shows the
 * result: two verification uploads in storage, zero verification requests ever
 * created.
 */
describe('readUploadedMediaId', () => {
  const uploadResponse = {
    publicUrl: '/api/media/verification/abc.webp',
    key: 'verification/abc.webp',
    mediaId: '4aac29e5-7aaa-4d18-ac6e-a154bd6caf80',
    media: { id: '4aac29e5-7aaa-4d18-ac6e-a154bd6caf80' },
  };

  it('reads the id the endpoint actually returns', () => {
    expect(readUploadedMediaId(uploadResponse, 'selfie')).toBe(
      '4aac29e5-7aaa-4d18-ac6e-a154bd6caf80',
    );
  });

  it('falls back to the nested media row', () => {
    const { mediaId, ...withoutTopLevel } = uploadResponse;
    expect(readUploadedMediaId(withoutTopLevel, 'college ID')).toBe(
      '4aac29e5-7aaa-4d18-ac6e-a154bd6caf80',
    );
  });

  it('throws rather than returning undefined', () => {
    // This is the whole point: an id that cannot be resolved must stop the
    // submission, not travel onward as `undefined` and get silently dropped
    // from the JSON body.
    expect(() => readUploadedMediaId({ key: 'k' }, 'selfie')).toThrow(
      VerificationDocumentError,
    );
    expect(() => readUploadedMediaId(null, 'selfie')).toThrow(/selfie/);
  });

  it('names the document in its error, so the user knows which to replace', () => {
    try {
      readUploadedMediaId({}, 'college ID');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.label).toBe('college ID');
      expect(err.message).toContain('college ID');
    }
  });
});

describe('verification processing settings', () => {
  it('does not accept animated GIF as an identity document', () => {
    // The generic image allowlist includes GIF; a document has to be a still
    // the server can verify the bytes of.
    expect(VERIFICATION_ALLOWED_TYPES).not.toContain('image/gif');
    expect(VERIFICATION_ALLOWED_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });

  it('preserves enough detail to read an ID', () => {
    // The generic post settings (1920px / q0.8 / 1 MB) throw away exactly the
    // detail an identity decision depends on.
    expect(VERIFICATION_COMPRESS_OPTIONS.maxWidthOrHeight).toBeGreaterThan(1920);
    expect(VERIFICATION_COMPRESS_OPTIONS.initialQuality).toBeGreaterThanOrEqual(0.9);
    expect(VERIFICATION_COMPRESS_OPTIONS.maxSizeMB).toBeGreaterThan(1);
  });

  it('still converts to the app’s standard format', () => {
    // 87% of the media table is WebP; verification was the outlier.
    expect(VERIFICATION_COMPRESS_OPTIONS.fileType).toBe('image/webp');
  });
});
