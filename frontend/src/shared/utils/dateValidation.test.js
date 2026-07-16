import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateDOB } from './dateValidation';

describe('validateDOB', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects empty or partial dates', () => {
    expect(validateDOB('', 5, 15).isValid).toBe(false);
    expect(validateDOB(2000, '', 15).isValid).toBe(false);
    expect(validateDOB(2000, 5, '').isValid).toBe(false);
    expect(validateDOB(undefined, undefined, undefined).isValid).toBe(false);
  });

  it('rejects invalid inputs', () => {
    expect(validateDOB('abcd', 'ef', 'gh').isValid).toBe(false);
  });

  describe('Standard Age Validation (Mocked to 2024-05-15)', () => {
    beforeEach(() => {
      // Mock local date to May 15, 2024
      vi.setSystemTime(new Date(2024, 4, 15));
    });

    it('accepts exactly 18 years old today', () => {
      const res = validateDOB(2006, 5, 15);
      expect(res.isValid).toBe(true);
      expect(res.dobString).toBe('2006-05-15');
    });

    it('accepts 18 years + 1 day old', () => {
      const res = validateDOB(2006, 5, 14);
      expect(res.isValid).toBe(true);
    });

    it('accepts older users', () => {
      const res = validateDOB(1990, 1, 1);
      expect(res.isValid).toBe(true);
    });

    it('rejects 17 years, 364 days old (turns 18 tomorrow)', () => {
      const res = validateDOB(2006, 5, 16);
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('You must be at least 18 years old.');
    });

    it('rejects future DOB', () => {
      const res = validateDOB(2025, 1, 1);
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Date of birth cannot be in the future.');
    });
  });

  describe('Calendar Bounds & Impossible Dates', () => {
    beforeEach(() => {
      vi.setSystemTime(new Date(2024, 4, 15));
    });

    it('rejects February 30', () => {
      expect(validateDOB(2020, 2, 30).isValid).toBe(false);
    });

    it('rejects February 31', () => {
      expect(validateDOB(2020, 2, 31).isValid).toBe(false);
    });

    it('rejects April 31', () => {
      expect(validateDOB(2020, 4, 31).isValid).toBe(false);
    });

    it('rejects February 29 on non-leap years', () => {
      expect(validateDOB(2023, 2, 29).isValid).toBe(false);
    });

    it('accepts February 29 on leap years', () => {
      expect(validateDOB(2004, 2, 29).isValid).toBe(true);
    });
  });

  describe('Leap Year Birthday Boundaries (Born 2004-02-29)', () => {
    it('is 17 on Feb 28, 2022', () => {
      vi.setSystemTime(new Date(2022, 1, 28));
      const res = validateDOB(2004, 2, 29);
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('You must be at least 18 years old.');
    });

    it('turns 18 on March 1, 2022 (Standard JS leapling rollover)', () => {
      vi.setSystemTime(new Date(2022, 2, 1));
      const res = validateDOB(2004, 2, 29);
      expect(res.isValid).toBe(true);
    });
  });

  describe('Extreme Age Bounds', () => {
    beforeEach(() => {
      vi.setSystemTime(new Date(2024, 4, 15));
    });

    it('rejects age over 120 (prevent 1900 born issues)', () => {
      // 120 years before 2024 is 1904
      expect(validateDOB(1899, 1, 1).isValid).toBe(false);
      expect(validateDOB(1899, 1, 1).error).toBe('Please enter a valid date.');
    });
  });
});
