import { apiClient } from '@shared/api/apiClient';

/**
 * Client-side access to the academic catalogue.
 *
 * The catalogue itself is NOT defined here. It is served by the backend from a
 * single canonical file, so the dropdowns can never offer a combination the
 * server would reject. Shipping a second copy in the bundle is exactly the
 * duplication this replaces.
 *
 * @typedef {{ id: string, name: string }} AcademicBranch
 * @typedef {{ id: string, name: string, durationYears: number, branches: AcademicBranch[] }} AcademicCourse
 * @typedef {{ course: string, branch: string, passingYear: number|null }} AcademicSelectionValue
 */

const CACHE_KEY = 'meetifyy_academic_catalog_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** De-duplicates concurrent callers so a page with two forms fetches once. */
let inFlight = null;
let memory = null;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { courses, at } = JSON.parse(raw);
    if (!Array.isArray(courses) || !courses.length) return null;
    if (Date.now() - at > CACHE_TTL_MS) return null;
    return courses;
  } catch {
    return null;
  }
}

function writeCache(courses) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ courses, at: Date.now() }));
  } catch {
    // Private mode / quota — the in-memory copy still serves this session.
  }
}

/** @returns {Promise<AcademicCourse[]>} */
export function loadAcademicCatalog() {
  if (memory) return Promise.resolve(memory);

  const cached = readCache();
  if (cached) {
    memory = cached;
    return Promise.resolve(cached);
  }

  if (inFlight) return inFlight;

  inFlight = apiClient
    .get('/api/academics/catalog')
    .then((res) => {
      const courses = res?.courses || [];
      if (courses.length) {
        memory = courses;
        writeCache(courses);
      }
      return courses;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

// ── Pure helpers (catalogue passed in, so they stay testable and sync) ────────

/** @returns {AcademicCourse|null} */
export function findCourse(courses, courseId) {
  if (!courses || !courseId) return null;
  return courses.find((c) => c.id === courseId) || null;
}

/** @returns {AcademicBranch[]} */
export function branchesForCourse(courses, courseId) {
  return findCourse(courses, courseId)?.branches || [];
}

/** @returns {number[]} e.g. [2026, 2027, ... 2036] dynamically from current year to current year + 10 */
export function validPassingYears(nowYear = new Date().getFullYear()) {
  return Array.from({ length: 11 }, (_, i) => nowYear + i);
}

export function yearLabel(year) {
  return String(year);
}

/**
 * Drops any part of a selection that is not valid against the catalogue, keeping
 * the parts that still are.
 *
 * @returns {{ value: AcademicSelectionValue, changed: boolean, cleared: string[] }}
 */
export function sanitizeAcademicSelection(courses, raw) {
  const cleared = [];
  const courseId = typeof raw?.course === 'string' ? raw.course : '';
  const course = findCourse(courses, courseId);

  const rawYear = raw?.passingYear ?? raw?.currentYear;
  let passingYear = Number.isInteger(rawYear)
    ? rawYear
    : /^\d+$/.test(String(rawYear ?? ''))
      ? parseInt(rawYear, 10)
      : null;

  const currentYearNow = new Date().getFullYear();
  if (passingYear !== null && (passingYear < currentYearNow || passingYear > currentYearNow + 10)) {
    passingYear = null;
    cleared.push('passingYear');
  }

  if (courseId && !course) {
    // Unknown course invalidates course and branch, but passingYear can stand on its own
    return {
      value: { course: '', branch: '', passingYear },
      changed: true,
      cleared: ['course', 'branch', ...cleared],
    };
  }

  let branch = typeof raw?.branch === 'string' ? raw.branch : '';
  if (branch && (!course || !course.branches.some((b) => b.id === branch))) {
    branch = '';
    cleared.push('branch');
  }

  return {
    value: { course: course ? courseId : '', branch, passingYear },
    changed: cleared.length > 0,
    cleared,
  };
}

/**
 * "B.Tech • Computer Science & Engineering • 2028".
 * Mirrors the server-side formatter so profiles read identically everywhere.
 * @param {{ branch?: boolean, year?: boolean }} [parts] which segments to include
 * @returns {string|null}
 */
export function formatAcademic(courses, course, branch, passingYear, parts = {}) {
  const { branch: withBranch = true, year: withYear = true } = parts;
  const c = findCourse(courses, course);
  if (!c) return null;
  const b = c.branches.find((x) => x.id === branch);
  const out = [c.name];
  if (withBranch && b && b.id !== 'general') out.push(b.name);
  if (withYear && Number.isInteger(passingYear) && passingYear > 0) out.push(yearLabel(passingYear));
  return out.join(' • ');
}

/** Shared error copy — identical wording to the backend's ACADEMIC_ERRORS. */
export const ACADEMIC_ERRORS = {
  COURSE_REQUIRED: 'Please select your course.',
  BRANCH_REQUIRED: 'Please select your branch.',
  YEAR_REQUIRED: 'Please select your passing year.',
  BRANCH_NOT_IN_COURSE: 'This branch is not available for the selected course.',
  YEAR_INVALID: 'Please select a valid passing year.',
};

/** Client-side pre-submit check. The server re-validates regardless. */
export function validateAcademicSelection(courses, value) {
  if (!value?.course) return ACADEMIC_ERRORS.COURSE_REQUIRED;
  const course = findCourse(courses, value.course);
  if (!course) return ACADEMIC_ERRORS.COURSE_REQUIRED;
  if (!value.branch) return ACADEMIC_ERRORS.BRANCH_REQUIRED;
  if (!course.branches.some((b) => b.id === value.branch)) return ACADEMIC_ERRORS.BRANCH_NOT_IN_COURSE;
  
  const rawYear = value?.passingYear ?? value?.currentYear;
  if (!Number.isInteger(rawYear)) return ACADEMIC_ERRORS.YEAR_REQUIRED;
  const now = new Date().getFullYear();
  if (rawYear < now || rawYear > now + 10) {
    return ACADEMIC_ERRORS.YEAR_INVALID;
  }
  return null;
}
