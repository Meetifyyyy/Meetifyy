import { describe, it, expect } from 'vitest';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  MAX_COVERED_IMAGE_SIZE_MB,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  COVERED_IMAGE_FOLDERS,
  ALLOWED_IMAGE_ACCEPT,
  ALLOWED_MEDIA_ACCEPT,
  isCoveredImageFolder,
  validateCoveredImageFile,
  UPLOAD_LIMITS,
  checkUploadFile,
  sniffMediaKind,
  uploadContextForFolder,
  validateUploadFile,
} from '../../constants/mediaLimits';
import { validateFile } from '../mediaPipeline';

describe('Frontend Media Limits & Validation', () => {
  describe('Constants & isCoveredImageFolder', () => {
    it('defines 10 MB in bytes correctly', () => {
      expect(MAX_COVERED_IMAGE_SIZE_MB).toBe(10);
      expect(MAX_COVERED_IMAGE_SIZE_BYTES).toBe(10 * 1024 * 1024);
    });

    it('defines specific accept strings for images and media', () => {
      expect(ALLOWED_IMAGE_ACCEPT).toContain('image/jpeg');
      expect(ALLOWED_IMAGE_ACCEPT).toContain('image/png');
      expect(ALLOWED_IMAGE_ACCEPT).toContain('image/webp');
      expect(ALLOWED_IMAGE_ACCEPT).toContain('.jpg');
      expect(ALLOWED_MEDIA_ACCEPT).toContain('video/mp4');
    });

    it.each(COVERED_IMAGE_FOLDERS)('classifies "%s" as a covered image folder', (folder) => {
      expect(isCoveredImageFolder(folder)).toBe(true);
    });

    it.each(['posts', 'chat', 'voice', 'general', 'support'])(
      'does not classify "%s" as a covered image folder',
      (folder) => {
        expect(isCoveredImageFolder(folder)).toBe(false);
      },
    );
  });

  describe('validateCoveredImageFile helper', () => {
    it('accepts file under 10 MB', () => {
      const file = new File(['x'.repeat(1024)], 'test.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 });
      const result = validateCoveredImageFile(file);
      expect(result.valid).toBe(true);
    });

    it('accepts file exactly at 10 MB limit', () => {
      const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'size', { value: MAX_COVERED_IMAGE_SIZE_BYTES });
      const result = validateCoveredImageFile(file);
      expect(result.valid).toBe(true);
    });

    it('rejects file larger than 10 MB with standard error message', () => {
      const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'size', { value: MAX_COVERED_IMAGE_SIZE_BYTES + 1 });
      const result = validateCoveredImageFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toBe(COVERED_IMAGE_SIZE_ERROR_MESSAGE);
    });

    it('rejects null/undefined file', () => {
      expect(validateCoveredImageFile(null).valid).toBe(false);
    });
  });

  describe('validateFile pipeline function', () => {
    it('accepts valid 5 MB image with default options (10 MB limit)', () => {
      const file = new File(['x'], 'test.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 });
      expect(validateFile(file)).toBe(true);
    });

    it('rejects 11 MB image with default options (10 MB limit)', () => {
      const file = new File(['x'], 'test.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
      expect(() => validateFile(file)).toThrow('File size limit is 10 MB');
    });

    it('allows 30 MB file when maxSizeMB is set to 50 (for posts / chat media)', () => {
      const file = new File(['x'], 'post.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'size', { value: 30 * 1024 * 1024 });
      expect(validateFile(file, { maxSizeMB: 50 })).toBe(true);
    });

    it('rejects invalid image types with "Invalid image format"', () => {
      const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
      expect(() => validateFile(file)).toThrow('Invalid image format');
    });
  });
});

describe('Per-file limits for messages and posts', () => {
  const MB = 1024 * 1024;
  const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1];
  const MP4 = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0];
  const WEBM = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81, 1, 0, 0, 0];

  /** A File with real leading bytes and whatever size the case needs. */
  const fileOf = (bytes, name, type, size) => {
    const file = new File([new Uint8Array(bytes)], name, { type });
    if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
    return file;
  };

  it('has the agreed numbers, per file', () => {
    expect(UPLOAD_LIMITS.message).toEqual({ video: 15 * MB, image: 5 * MB });
    expect(UPLOAD_LIMITS.post).toEqual({ video: 25 * MB, image: 5 * MB });
  });

  it.each([
    ['message', 'video/mp4', 15 * MB, 'Video must be 15 MB or less'],
    ['message', 'image/jpeg', 5 * MB, 'Image must be 5 MB or less'],
    ['post', 'video/mp4', 25 * MB, 'Video must be 25 MB or less'],
    ['post', 'image/jpeg', 5 * MB, 'Image must be 5 MB or less'],
  ])('%s %s: allowed at exactly the limit, refused one byte over', (context, type, limit, message) => {
    const at = checkUploadFile(fileOf([], 'f', type, limit), context);
    expect(at).toEqual({ ok: true, kind: type.startsWith('video') ? 'video' : 'image' });
    const over = checkUploadFile(fileOf([], 'f', type, limit + 1), context);
    expect(over).toEqual({ ok: false, error: message });
  });

  it('refuses empty files and formats the server does not store', () => {
    expect(checkUploadFile(fileOf([], 'e.mp4', 'video/mp4', 0), 'message').error).toBe('This file is empty');
    expect(checkUploadFile(fileOf([], 'clip.mov', 'video/quicktime', 10), 'message').error).toBe('Use an MP4 or WebM video');
    expect(checkUploadFile(fileOf([], 'p.heic', 'image/heic', 10), 'post').error).toBe('Unsupported image format');
    expect(checkUploadFile(fileOf([], 'a.pdf', 'application/pdf', 10), 'post').error).toBe('Unsupported file type');
  });

  it('holds a single-kind picker to its kind', () => {
    expect(checkUploadFile(fileOf([], 'v.mp4', 'video/mp4', 10), 'post', { expect: 'image' }).error).toBe('Choose an image');
    expect(checkUploadFile(fileOf([], 'p.jpg', 'image/jpeg', 10), 'post', { expect: 'video' }).error).toBe('Choose a video');
  });

  it('maps storage folders to their limits', () => {
    expect(uploadContextForFolder('chat')).toBe('message');
    expect(uploadContextForFolder('posts')).toBe('post');
    expect(uploadContextForFolder('avatars')).toBeNull();
  });

  it('reads the kind from the bytes', () => {
    expect(sniffMediaKind(new Uint8Array(JPEG))).toBe('image');
    expect(sniffMediaKind(new Uint8Array(MP4))).toBe('video');
    expect(sniffMediaKind(new Uint8Array(WEBM))).toBe('video');
    expect(sniffMediaKind(new TextEncoder().encode('just some text here'))).toBeNull();
  });

  it('refuses a file whose bytes are not what its name says', async () => {
    const renamed = fileOf([...new TextEncoder().encode('MZ this is a program')], 'clip.mp4', 'video/mp4');
    expect(await validateUploadFile(renamed, 'message')).toEqual({ ok: false, error: "Couldn't read this file" });
    const swapped = fileOf(JPEG, 'clip.mp4', 'video/mp4');
    expect((await validateUploadFile(swapped, 'message')).ok).toBe(false);
    expect(await validateUploadFile(fileOf(MP4, 'clip.mp4', 'video/mp4'), 'message')).toEqual({ ok: true, kind: 'video' });
  });

  it('accepts a real file within the limit', async () => {
    expect(await validateUploadFile(fileOf(JPEG, 'p.jpg', 'image/jpeg'), 'post')).toEqual({ ok: true, kind: 'image' });
  });

  it('no longer offers .mov in the picker, since nothing stores it', () => {
    expect(ALLOWED_MEDIA_ACCEPT).not.toMatch(/quicktime|\.mov/);
  });
});
