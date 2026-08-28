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
