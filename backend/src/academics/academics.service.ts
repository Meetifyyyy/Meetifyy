import { Injectable, BadRequestException } from '@nestjs/common';
import {
  ACADEMIC_CATALOG,
  AcademicCourse,
  findBranch,
  findCourse,
  formatAcademicSummary,
} from './academic-catalog';

/** Shape persisted on the user record. */
export interface AcademicSelection {
  course: string;
  branch: string;
  currentYear: number;
}

/** Error copy lives here so client and server report the same wording. */
export const ACADEMIC_ERRORS = {
  COURSE_REQUIRED: 'Please select your course.',
  BRANCH_REQUIRED: 'Please select your branch.',
  YEAR_REQUIRED: 'Please select your current year.',
  COURSE_UNKNOWN: 'Please select your course.',
  BRANCH_NOT_IN_COURSE: 'This branch is not available for the selected course.',
  YEAR_NOT_IN_COURSE: 'This year is not valid for the selected course.',
} as const;

@Injectable()
export class AcademicsService {
  /** The catalogue as served to clients. */
  getCatalog(): readonly AcademicCourse[] {
    return ACADEMIC_CATALOG;
  }

  /**
   * Validates a course/branch/year triple. Every field is treated as untrusted:
   * the client's dropdowns are a convenience, not a constraint, so a handcrafted
   * request pairing "B.Tech" with an MBA branch, or a 3-year course with a 4th
   * year, is rejected here regardless of what the UI allows.
   *
   * Throws BadRequestException with a message the UI can show verbatim.
   */
  validate(input: {
    course?: unknown;
    branch?: unknown;
    currentYear?: unknown;
  }): AcademicSelection {
    const courseId = typeof input.course === 'string' ? input.course.trim() : '';
    const branchId = typeof input.branch === 'string' ? input.branch.trim() : '';

    if (!courseId) throw new BadRequestException(ACADEMIC_ERRORS.COURSE_REQUIRED);
    const course = findCourse(courseId);
    if (!course) throw new BadRequestException(ACADEMIC_ERRORS.COURSE_UNKNOWN);

    if (!branchId) throw new BadRequestException(ACADEMIC_ERRORS.BRANCH_REQUIRED);
    if (!findBranch(courseId, branchId)) {
      throw new BadRequestException(ACADEMIC_ERRORS.BRANCH_NOT_IN_COURSE);
    }

    // Accept a number or a numeric string, but nothing else — "2nd", NaN, 2.5,
    // negatives and Infinity all fall through to the range check below.
    const rawYear = input.currentYear;
    const year =
      typeof rawYear === 'number'
        ? rawYear
        : typeof rawYear === 'string' && /^\d+$/.test(rawYear.trim())
          ? parseInt(rawYear.trim(), 10)
          : NaN;

    if (!Number.isInteger(year)) throw new BadRequestException(ACADEMIC_ERRORS.YEAR_REQUIRED);
    if (year < 1 || year > course.durationYears) {
      throw new BadRequestException(ACADEMIC_ERRORS.YEAR_NOT_IN_COURSE);
    }

    return { course: courseId, branch: branchId, currentYear: year };
  }

  /**
   * Non-throwing variant for optional updates: returns null when nothing
   * academic was supplied, so a settings save that only changes a bio doesn't
   * have to send academic fields at all.
   */
  validateIfPresent(input: {
    course?: unknown;
    branch?: unknown;
    currentYear?: unknown;
  }): AcademicSelection | null {
    // `undefined`, `null` and `''` all mean "not supplied". Callers routinely
    // spread a whole form object here — a signup draft carries `currentYear:
    // null` before the user reaches that step — and treating those as an attempt
    // to set academic data would reject an otherwise valid profile update.
    const absent = (v: unknown) => v === undefined || v === null || v === '';
    if (absent(input.course) && absent(input.branch) && absent(input.currentYear)) {
      return null;
    }
    // Anything partially filled still goes through full validation, so a request
    // cannot persist a course without a branch.
    return this.validate(input);
  }

  /** True when a stored triple is still valid — used when loading legacy rows. */
  isComplete(course?: string | null, branch?: string | null, currentYear?: number | null): boolean {
    if (!course || !branch || typeof currentYear !== 'number') return false;
    const c = findCourse(course);
    if (!c) return false;
    if (!findBranch(course, branch)) return false;
    return currentYear >= 1 && currentYear <= c.durationYears;
  }

  format(course?: string | null, branch?: string | null, currentYear?: number | null): string | null {
    return formatAcademicSummary(course, branch, currentYear);
  }
}
