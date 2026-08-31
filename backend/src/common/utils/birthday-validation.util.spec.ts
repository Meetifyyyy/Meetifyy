import { BadRequestException } from '@nestjs/common';
import { validateBirthday } from './birthday-validation.util';

/**
 * Returns a date string (YYYY-MM-DD) for someone who is exactly `years` years
 * old relative to today. Always computed from the real current date so the
 * test remains correct regardless of when it runs.
 */
function yearsAgo(years: number): string {
  const today = new Date();
  const d = new Date(today);
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe('validateBirthday', () => {
  // ── Input guards ─────────────────────────────────────────────────────────

  describe('missing / invalid input', () => {
    it.each([null, undefined, '', '  '])(
      'throws when input is %p',
      (input: any) => {
        expect(() => validateBirthday(input)).toThrow(BadRequestException);
        expect(() => validateBirthday(input)).toThrow(
          'Date of birth is required.',
        );
      },
    );

    it('throws for a non-string (number)', () => {
      expect(() => validateBirthday(19900101 as any)).toThrow(
        BadRequestException,
      );
    });

    it('throws for wrong format (MM/DD/YYYY)', () => {
      expect(() => validateBirthday('06/15/1990')).toThrow(BadRequestException);
    });

    it('throws for missing day segment', () => {
      expect(() => validateBirthday('1990-06')).toThrow(BadRequestException);
    });

    it('throws for non-numeric components', () => {
      expect(() => validateBirthday('19XX-06-15')).toThrow(BadRequestException);
    });
  });

  // ── Month boundary ────────────────────────────────────────────────────────

  describe('month validation', () => {
    it('throws for month 0', () => {
      expect(() => validateBirthday('1990-00-15')).toThrow(
        'Please select a valid month.',
      );
    });

    it('throws for month 13', () => {
      expect(() => validateBirthday('1990-13-15')).toThrow(
        'Please select a valid month.',
      );
    });

    it('accepts month 1 (January)', () => {
      expect(() => validateBirthday('1990-01-15')).not.toThrow();
    });

    it('accepts month 12 (December)', () => {
      expect(() => validateBirthday('1990-12-15')).not.toThrow();
    });
  });

  // ── Day boundary ─────────────────────────────────────────────────────────

  describe('day validation', () => {
    it('throws for day 0', () => {
      expect(() => validateBirthday('1990-06-00')).toThrow(BadRequestException);
    });

    it('throws for day 32', () => {
      expect(() => validateBirthday('1990-06-32')).toThrow(BadRequestException);
    });

    it('throws for April 31 (30-day month)', () => {
      expect(() => validateBirthday('1990-04-31')).toThrow(
        'April has only 30 days.',
      );
    });

    it('throws for June 31', () => {
      expect(() => validateBirthday('1990-06-31')).toThrow(
        'June has only 30 days.',
      );
    });

    it('throws for September 31', () => {
      expect(() => validateBirthday('1990-09-31')).toThrow(
        'September has only 30 days.',
      );
    });

    it('throws for November 31', () => {
      expect(() => validateBirthday('1990-11-31')).toThrow(
        'November has only 30 days.',
      );
    });
  });

  // ── February / leap-year ─────────────────────────────────────────────────

  describe('February edge cases', () => {
    it('throws for Feb 29 on a non-leap year (1990)', () => {
      expect(() => validateBirthday('1990-02-29')).toThrow(
        'February has only 28 days in 1990.',
      );
    });

    it('throws for Feb 30 even on a leap year', () => {
      expect(() => validateBirthday('2000-02-30')).toThrow(BadRequestException);
    });

    it('accepts Feb 29 on a leap year (2000)', () => {
      // 2000 is a leap year (divisible by 400).
      // The user would be born in 2000, so at least 18 in 2024 — fine.
      expect(() => validateBirthday('2000-02-29')).not.toThrow();
    });

    it('accepts Feb 29 on a leap year (1996)', () => {
      expect(() => validateBirthday('1996-02-29')).not.toThrow();
    });

    it('throws for Feb 29 on a century year that is NOT a leap year (1900)', () => {
      // 1900 is not a leap year (divisible by 100 but not 400).
      expect(() => validateBirthday('1900-02-29')).toThrow(BadRequestException);
    });
  });

  // ── Year boundary ─────────────────────────────────────────────────────────

  describe('year boundary', () => {
    it('throws for year before 1950', () => {
      expect(() => validateBirthday('1949-06-15')).toThrow(BadRequestException);
    });

    it('accepts year 1950', () => {
      // 1950 → well over 18, under 120 (in 2024).
      expect(() => validateBirthday('1950-06-15')).not.toThrow();
    });
  });

  // ── Future date ───────────────────────────────────────────────────────────

  describe('future date', () => {
    it('throws when date is tomorrow', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const str = tomorrow.toISOString().slice(0, 10);
      expect(() => validateBirthday(str)).toThrow(
        'You must be at least 18 years old.',
      );
    });
  });

  // ── Age constraints ───────────────────────────────────────────────────────

  describe('age constraints', () => {
    it('throws when user is 17 years old', () => {
      expect(() => validateBirthday(yearsAgo(17))).toThrow(
        'You must be at least 18 years old.',
      );
    });

    it('accepts a user who is exactly 18 today', () => {
      // Use actual today to avoid clock drift issues
      const today = new Date();
      const d = new Date(today);
      d.setFullYear(d.getFullYear() - 18);
      const str = d.toISOString().slice(0, 10);
      expect(() => validateBirthday(str)).not.toThrow();
    });

    it('accepts a user who is 25 years old', () => {
      expect(() => validateBirthday(yearsAgo(25))).not.toThrow();
    });

    it('throws when user would be over 120 years old', () => {
      expect(() => validateBirthday('1900-01-01')).toThrow(BadRequestException);
    });
  });

  // ── Valid dates ───────────────────────────────────────────────────────────

  describe('valid dates', () => {
    it('accepts a normal date within age range', () => {
      expect(() => validateBirthday('1995-08-20')).not.toThrow();
    });

    it('accepts Jan 31 (31-day month)', () => {
      expect(() => validateBirthday('1990-01-31')).not.toThrow();
    });

    it('accepts Dec 31', () => {
      expect(() => validateBirthday('1990-12-31')).not.toThrow();
    });
  });
});
