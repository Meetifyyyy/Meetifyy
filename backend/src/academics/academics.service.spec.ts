import { BadRequestException } from '@nestjs/common';
import { AcademicsService, ACADEMIC_ERRORS } from './academics.service';
import { ACADEMIC_CATALOG, validPassingYears } from './academic-catalog';

describe('AcademicsService', () => {
  const service = new AcademicsService();
  const currentYearNow = new Date().getFullYear();

  const expectReject = (input: any, message: string) => {
    expect(() => service.validate(input)).toThrow(BadRequestException);
    expect(() => service.validate(input)).toThrow(message);
  };

  describe('catalogue integrity', () => {
    it('has unique course ids and no empty branch lists', () => {
      const ids = ACADEMIC_CATALOG.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const course of ACADEMIC_CATALOG) {
        expect(course.branches.length).toBeGreaterThan(0);
        expect(course.durationYears).toBeGreaterThanOrEqual(1);
        const bIds = course.branches.map((b) => b.id);
        expect(new Set(bIds).size).toBe(bIds.length);
      }
    });

    it('dynamically derives passing year options covering current year to current year + 10', () => {
      const years = validPassingYears(currentYearNow);
      expect(years.length).toBe(11);
      expect(years[0]).toBe(currentYearNow);
      expect(years[10]).toBe(currentYearNow + 10);
    });
  });

  describe('accepts valid selections', () => {
    it('accepts a real course/branch/passingYear triple', () => {
      expect(
        service.validate({
          course: 'btech',
          branch: 'cse',
          passingYear: currentYearNow + 2,
        }),
      ).toEqual({
        course: 'btech',
        branch: 'cse',
        passingYear: currentYearNow + 2,
      });
    });

    it('accepts a numeric string year, as sent by an HTML select', () => {
      expect(
        service.validate({
          course: 'bca',
          branch: 'general',
          passingYear: String(currentYearNow + 1),
        }).passingYear,
      ).toBe(currentYearNow + 1);
    });

    it('accepts current year and current year + 10', () => {
      expect(() =>
        service.validate({
          course: 'btech',
          branch: 'cse',
          passingYear: currentYearNow,
        }),
      ).not.toThrow();

      expect(() =>
        service.validate({
          course: 'btech',
          branch: 'cse',
          passingYear: currentYearNow + 10,
        }),
      ).not.toThrow();
    });
  });

  describe('rejects untrusted input', () => {
    it('rejects an unknown course', () => {
      expectReject(
        {
          course: 'hogwarts',
          branch: 'cse',
          passingYear: currentYearNow + 1,
        },
        ACADEMIC_ERRORS.COURSE_UNKNOWN,
      );
    });

    it('rejects a branch belonging to a different course', () => {
      expectReject(
        {
          course: 'btech',
          branch: 'business-analytics',
          passingYear: currentYearNow + 1,
        },
        ACADEMIC_ERRORS.BRANCH_NOT_IN_COURSE,
      );
    });

    it('rejects a year before current year or beyond current year + 10', () => {
      expectReject(
        {
          course: 'bca',
          branch: 'general',
          passingYear: currentYearNow - 1,
        },
        ACADEMIC_ERRORS.YEAR_INVALID,
      );
      expectReject(
        {
          course: 'bca',
          branch: 'general',
          passingYear: currentYearNow + 11,
        },
        ACADEMIC_ERRORS.YEAR_INVALID,
      );
    });

    it('rejects zero, negative and malformed years', () => {
      for (const bad of [
        0,
        -1,
        2.5,
        NaN,
        Infinity,
        '2nd',
        'abc',
        null,
        {},
        [],
      ]) {
        expect(() =>
          service.validate({
            course: 'btech',
            branch: 'cse',
            passingYear: bad,
          }),
        ).toThrow(BadRequestException);
      }
    });

    it('rejects missing fields', () => {
      expectReject(
        { branch: 'cse', passingYear: currentYearNow + 1 },
        ACADEMIC_ERRORS.COURSE_REQUIRED,
      );
      expectReject(
        { course: 'btech', passingYear: currentYearNow + 1 },
        ACADEMIC_ERRORS.BRANCH_REQUIRED,
      );
      expectReject(
        { course: 'btech', branch: 'cse' },
        ACADEMIC_ERRORS.YEAR_REQUIRED,
      );
    });

    it('rejects non-string course/branch types', () => {
      expect(() =>
        service.validate({
          course: 123,
          branch: 'cse',
          passingYear: currentYearNow + 1,
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        service.validate({
          course: 'btech',
          branch: { id: 'cse' },
          passingYear: currentYearNow + 1,
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('validateIfPresent', () => {
    it('returns null when no academic field is supplied at all', () => {
      expect(service.validateIfPresent({})).toBeNull();
    });

    it('treats null/empty as absent, not as an invalid attempt', () => {
      expect(
        service.validateIfPresent({
          course: '',
          branch: '',
          passingYear: null,
        }),
      ).toBeNull();
      expect(
        service.validateIfPresent({
          course: null,
          branch: null,
          passingYear: null,
        }),
      ).toBeNull();
    });

    it('still validates a partial update rather than silently accepting it', () => {
      expect(() => service.validateIfPresent({ course: 'btech' })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('isComplete', () => {
    it('is true only for a fully valid triple', () => {
      expect(service.isComplete('btech', 'cse', currentYearNow + 2)).toBe(true);
      expect(service.isComplete('btech', 'cse', currentYearNow - 1)).toBe(false);
      expect(service.isComplete('btech', 'cse', currentYearNow + 15)).toBe(false);
      expect(service.isComplete('btech', 'business-analytics', currentYearNow + 1)).toBe(false);
      expect(service.isComplete(null, null, null)).toBe(false);
      expect(service.isComplete(undefined, undefined, undefined)).toBe(false);
    });
  });

  describe('format', () => {
    it('renders course, branch and passing year', () => {
      expect(service.format('btech', 'cse', 2028)).toBe(
        'B.Tech • Computer Science & Engineering • 2028',
      );
    });

    it('omits a meaningless "General" branch', () => {
      expect(service.format('bcom', 'general', 2027)).toBe('B.Com • 2027');
    });

    it('degrades gracefully for incomplete legacy profiles', () => {
      expect(service.format('btech', null, null)).toBe('B.Tech');
      expect(service.format(null, null, null)).toBeNull();
      expect(service.format('unknown-course', 'cse', 2028)).toBeNull();
    });
  });
});
