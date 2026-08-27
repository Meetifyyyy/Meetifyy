import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  passingYear: number;
}

/** Error copy lives here so client and server report the same wording. */
export const ACADEMIC_ERRORS = {
  COURSE_REQUIRED: 'Please select your course.',
  BRANCH_REQUIRED: 'Please select your branch.',
  YEAR_REQUIRED: 'Please select your passing year.',
  COURSE_UNKNOWN: 'Please select your course.',
  BRANCH_NOT_IN_COURSE: 'This branch is not available for the selected course.',
  YEAR_INVALID: 'Please select a valid passing year.',
} as const;

@Injectable()
export class AcademicsService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** The catalogue as served to clients. */
  getCatalog(): readonly AcademicCourse[] {
    return ACADEMIC_CATALOG;
  }

  /**
   * Fetches active approved colleges and their domains from the database.
   */
  async getColleges(): Promise<
    Array<{
      id: string;
      name: string;
      shortName?: string | null;
      domains: string[];
    }>
  > {
    if (!this.prisma) return [];
    const colleges = await this.prisma.college.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: 'APPROVED',
      },
      select: {
        id: true,
        name: true,
        shortName: true,
        domains: {
          where: { status: 'ACTIVE' },
          select: { domain: true, isPrimary: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return colleges.map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      domains: c.domains.map((d) => d.domain),
    }));
  }

  /**
   * Validates a course/branch/passingYear triple. Every field is treated as untrusted:
   * passingYear must be dynamically between Current Year and Current Year + 10.
   *
   * Throws BadRequestException with a message the UI can show verbatim.
   */
  validate(input: {
    course?: unknown;
    branch?: unknown;
    passingYear?: unknown;
    currentYear?: unknown;
  }): AcademicSelection {
    const courseId =
      typeof input.course === 'string' ? input.course.trim() : '';
    const branchId =
      typeof input.branch === 'string' ? input.branch.trim() : '';

    if (!courseId)
      throw new BadRequestException(ACADEMIC_ERRORS.COURSE_REQUIRED);
    const course = findCourse(courseId);
    if (!course) throw new BadRequestException(ACADEMIC_ERRORS.COURSE_UNKNOWN);

    if (!branchId)
      throw new BadRequestException(ACADEMIC_ERRORS.BRANCH_REQUIRED);
    if (!findBranch(courseId, branchId)) {
      throw new BadRequestException(ACADEMIC_ERRORS.BRANCH_NOT_IN_COURSE);
    }

    const rawYear = input.passingYear ?? input.currentYear;
    const year =
      typeof rawYear === 'number'
        ? rawYear
        : typeof rawYear === 'string' && /^\d+$/.test(rawYear.trim())
          ? parseInt(rawYear.trim(), 10)
          : NaN;

    const currentYearNow = new Date().getFullYear();
    const maxPassingYear = currentYearNow + 10;

    if (!Number.isInteger(year))
      throw new BadRequestException(ACADEMIC_ERRORS.YEAR_REQUIRED);
    if (year < currentYearNow || year > maxPassingYear) {
      throw new BadRequestException(ACADEMIC_ERRORS.YEAR_INVALID);
    }

    return { course: courseId, branch: branchId, passingYear: year };
  }

  /**
   * Non-throwing variant for optional updates: returns null when nothing
   * academic was supplied, so a settings save that only changes a bio doesn't
   * have to send academic fields at all.
   */
  validateIfPresent(input: {
    course?: unknown;
    branch?: unknown;
    passingYear?: unknown;
    currentYear?: unknown;
  }): AcademicSelection | null {
    const absent = (v: unknown) => v === undefined || v === null || v === '';
    if (
      absent(input.course) &&
      absent(input.branch) &&
      absent(input.passingYear) &&
      absent(input.currentYear)
    ) {
      return null;
    }
    return this.validate(input);
  }

  /** True when a stored triple is still valid. */
  isComplete(
    course?: string | null,
    branch?: string | null,
    passingYear?: number | null,
  ): boolean {
    if (!course || !branch || typeof passingYear !== 'number') return false;
    const c = findCourse(course);
    if (!c) return false;
    if (!findBranch(course, branch)) return false;
    const now = new Date().getFullYear();
    return passingYear >= now && passingYear <= now + 10;
  }

  format(
    course?: string | null,
    branch?: string | null,
    passingYear?: number | null,
  ): string | null {
    return formatAcademicSummary(course, branch, passingYear);
  }
}
