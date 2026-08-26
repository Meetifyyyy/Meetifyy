import { BadRequestException } from '@nestjs/common';
import { AcademicsService, ACADEMIC_ERRORS } from './academics.service';
import {
  ACADEMIC_CATALOG,
  findCourse,
  validYearsForCourse,
} from './academic-catalog';

describe('AcademicsService', () => {
  const service = new AcademicsService();

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
        // Branch ids only need to be unique WITHIN a course, since they are
        // always resolved together with a course id.
        const bIds = course.branches.map((b) => b.id);
        expect(new Set(bIds).size).toBe(bIds.length);
      }
    });

    it('derives year options from course duration', () => {
      expect(validYearsForCourse('btech')).toEqual([1, 2, 3, 4]);
      expect(validYearsForCourse('bca')).toEqual([1, 2, 3]);
      expect(validYearsForCourse('ba-llb')).toEqual([1, 2, 3, 4, 5]);
      expect(validYearsForCourse('llm')).toEqual([1]);
      // Lateral entry runs one year shorter than the standard programme.
      expect(validYearsForCourse('btech-lateral')).toEqual([1, 2, 3]);
      expect(validYearsForCourse('nope')).toEqual([]);
    });
  });

  describe('accepts valid selections', () => {
    it('accepts a real course/branch/year triple', () => {
      expect(
        service.validate({ course: 'btech', branch: 'cse', currentYear: 2 }),
      ).toEqual({
        course: 'btech',
        branch: 'cse',
        currentYear: 2,
      });
    });

    it('accepts a numeric string year, as sent by an HTML select', () => {
      expect(
        service.validate({ course: 'bca', branch: 'general', currentYear: '3' })
          .currentYear,
      ).toBe(3);
    });

    it('accepts the final year of every course in the catalogue', () => {
      for (const course of ACADEMIC_CATALOG) {
        const branch = course.branches[0];
        expect(() =>
          service.validate({
            course: course.id,
            branch: branch.id,
            currentYear: course.durationYears,
          }),
        ).not.toThrow();
      }
    });
  });

  describe('rejects untrusted input', () => {
    it('rejects an unknown course', () => {
      expectReject(
        { course: 'hogwarts', branch: 'cse', currentYear: 1 },
        ACADEMIC_ERRORS.COURSE_UNKNOWN,
      );
    });

    it('rejects a branch belonging to a different course', () => {
      // 'business-analytics' is an MBA branch, not a B.Tech one.
      expectReject(
        { course: 'btech', branch: 'business-analytics', currentYear: 1 },
        ACADEMIC_ERRORS.BRANCH_NOT_IN_COURSE,
      );
    });

    it('rejects a year beyond the course duration', () => {
      // BCA is a 3-year programme.
      expectReject(
        { course: 'bca', branch: 'general', currentYear: 4 },
        ACADEMIC_ERRORS.YEAR_NOT_IN_COURSE,
      );
      // LLM is a single year.
      expectReject(
        { course: 'llm', branch: 'banking-finance-cyber', currentYear: 2 },
        ACADEMIC_ERRORS.YEAR_NOT_IN_COURSE,
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
            currentYear: bad,
          }),
        ).toThrow(BadRequestException);
      }
    });

    it('rejects missing fields', () => {
      expectReject(
        { branch: 'cse', currentYear: 1 },
        ACADEMIC_ERRORS.COURSE_REQUIRED,
      );
      expectReject(
        { course: 'btech', currentYear: 1 },
        ACADEMIC_ERRORS.BRANCH_REQUIRED,
      );
      expectReject(
        { course: 'btech', branch: 'cse' },
        ACADEMIC_ERRORS.YEAR_REQUIRED,
      );
    });

    it('rejects non-string course/branch types', () => {
      expect(() =>
        service.validate({ course: 123, branch: 'cse', currentYear: 1 }),
      ).toThrow(BadRequestException);
      expect(() =>
        service.validate({
          course: 'btech',
          branch: { id: 'cse' },
          currentYear: 1,
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('validateIfPresent', () => {
    it('returns null when no academic field is supplied at all', () => {
      expect(service.validateIfPresent({})).toBeNull();
    });

    it('treats null/empty as absent, not as an invalid attempt', () => {
      // A signup draft spreads `currentYear: null` before that step is reached;
      // rejecting it would break an otherwise valid profile update.
      expect(
        service.validateIfPresent({
          course: '',
          branch: '',
          currentYear: null,
        }),
      ).toBeNull();
      expect(
        service.validateIfPresent({
          course: null,
          branch: null,
          currentYear: null,
        }),
      ).toBeNull();
    });

    it('still validates a partial update rather than silently accepting it', () => {
      // Sending only a course must not persist a course with no branch.
      expect(() => service.validateIfPresent({ course: 'btech' })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('isComplete', () => {
    it('is true only for a fully valid triple', () => {
      expect(service.isComplete('btech', 'cse', 3)).toBe(true);
      expect(service.isComplete('btech', 'cse', 9)).toBe(false);
      expect(service.isComplete('btech', 'business-analytics', 1)).toBe(false);
      expect(service.isComplete(null, null, null)).toBe(false);
      // Legacy rows left empty by the migration must read as incomplete, not crash.
      expect(service.isComplete(undefined, undefined, undefined)).toBe(false);
    });
  });

  describe('format', () => {
    it('renders course, branch and year', () => {
      expect(service.format('btech', 'cse', 2)).toBe(
        'B.Tech • Computer Science & Engineering • 2nd Year',
      );
    });

    it('omits a meaningless "General" branch', () => {
      expect(service.format('bcom', 'general', 1)).toBe('B.Com • 1st Year');
    });

    it('degrades gracefully for incomplete legacy profiles', () => {
      expect(service.format('btech', null, null)).toBe('B.Tech');
      expect(service.format(null, null, null)).toBeNull();
      expect(service.format('unknown-course', 'cse', 1)).toBeNull();
    });
  });
});
