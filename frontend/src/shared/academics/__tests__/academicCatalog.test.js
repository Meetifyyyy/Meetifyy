import { describe, it, expect } from 'vitest';
import {
  validPassingYears,
  yearLabel,
  sanitizeAcademicSelection,
  formatAcademic,
  validateAcademicSelection,
  ACADEMIC_ERRORS,
} from '../academicCatalog';

describe('academicCatalog client helpers', () => {
  const currentYearNow = new Date().getFullYear();

  const mockCourses = [
    {
      id: 'btech',
      name: 'B.Tech',
      durationYears: 4,
      branches: [
        { id: 'cse', name: 'Computer Science & Engineering' },
        { id: 'ece', name: 'Electronics & Communication Engineering' },
      ],
    },
    {
      id: 'bca',
      name: 'BCA',
      durationYears: 3,
      branches: [{ id: 'general', name: 'General' }],
    },
  ];

  it('validPassingYears returns 11 dynamic passing years starting from current year', () => {
    const years = validPassingYears(currentYearNow);
    expect(years).toHaveLength(11);
    expect(years[0]).toBe(currentYearNow);
    expect(years[10]).toBe(currentYearNow + 10);
  });

  it('yearLabel formats passing year string', () => {
    expect(yearLabel(2028)).toBe('2028');
  });

  it('sanitizeAcademicSelection cleans invalid course, branch or out-of-range passingYear', () => {
    const clean = sanitizeAcademicSelection(mockCourses, {
      course: 'btech',
      branch: 'cse',
      passingYear: currentYearNow + 2,
    });
    expect(clean.changed).toBe(false);
    expect(clean.value).toEqual({
      course: 'btech',
      branch: 'cse',
      passingYear: currentYearNow + 2,
    });

    const outOfRange = sanitizeAcademicSelection(mockCourses, {
      course: 'btech',
      branch: 'cse',
      passingYear: currentYearNow - 2,
    });
    expect(outOfRange.changed).toBe(true);
    expect(outOfRange.value.passingYear).toBeNull();
  });

  it('validateAcademicSelection accepts valid course/branch/passingYear', () => {
    expect(
      validateAcademicSelection(mockCourses, {
        course: 'btech',
        branch: 'cse',
        passingYear: currentYearNow + 2,
      }),
    ).toBeNull();
  });

  it('validateAcademicSelection rejects out-of-range passing years', () => {
    expect(
      validateAcademicSelection(mockCourses, {
        course: 'btech',
        branch: 'cse',
        passingYear: currentYearNow - 1,
      }),
    ).toBe(ACADEMIC_ERRORS.YEAR_INVALID);

    expect(
      validateAcademicSelection(mockCourses, {
        course: 'btech',
        branch: 'cse',
        passingYear: currentYearNow + 15,
      }),
    ).toBe(ACADEMIC_ERRORS.YEAR_INVALID);
  });

  it('formatAcademic formats course, branch and passing year', () => {
    expect(formatAcademic(mockCourses, 'btech', 'cse', 2028)).toBe(
      'B.Tech • Computer Science & Engineering • 2028',
    );
    expect(formatAcademic(mockCourses, 'bca', 'general', 2027)).toBe(
      'BCA • 2027',
    );
  });
});
