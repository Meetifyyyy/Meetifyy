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
 * @typedef {{ course: string, branch: string, currentYear: number|null }} AcademicSelectionValue
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

/** @returns {number[]} e.g. [1,2,3,4] — derived from the course's own duration. */
export function yearsForCourse(courses, courseId) {
  const course = findCourse(courses, courseId);
  if (!course) return [];
  return Array.from({ length: course.durationYears }, (_, i) => i + 1);
}

const YEAR_LABELS = {
  1: '1st Year',
  2: '2nd Year',
  3: '3rd Year',
  4: '4th Year',
  5: '5th Year',
  6: '6th Year',
};

export function yearLabel(year) {
  return YEAR_LABELS[year] || `Year ${year}`;
}

/**
 * Drops any part of a selection that is not valid against the catalogue, keeping
 * the parts that still are.
 *
 * This is what makes refresh/restore safe: a draft saved before the catalogue
 * changed (or hand-edited in devtools) can hold a branch that no longer belongs
 * to its course, or a 4th year on a 3-year course. Silently keeping those would
 * show the user a selection the server will reject on submit, so each field is
 * cleared independently rather than the whole selection being thrown away.
 *
 * @returns {{ value: AcademicSelectionValue, changed: boolean, cleared: string[] }}
 */
export function sanitizeAcademicSelection(courses, raw) {
  const cleared = [];
  const courseId = typeof raw?.course === 'string' ? raw.course : '';
  const course = findCourse(courses, courseId);

  if (courseId && !course) {
    // Unknown course invalidates everything below it.
    return {
      value: { course: '', branch: '', currentYear: null },
      changed: true,
      cleared: ['course', 'branch', 'currentYear'],
    };
  }

  let branch = typeof raw?.branch === 'string' ? raw.branch : '';
  if (branch && (!course || !course.branches.some((b) => b.id === branch))) {
    branch = '';
    cleared.push('branch');
  }

  let currentYear = Number.isInteger(raw?.currentYear)
    ? raw.currentYear
    : /^\d+$/.test(String(raw?.currentYear ?? ''))
      ? parseInt(raw.currentYear, 10)
      : null;
  if (currentYear !== null && (!course || currentYear < 1 || currentYear > course.durationYears)) {
    currentYear = null;
    cleared.push('currentYear');
  }

  return {
    value: { course: course ? courseId : '', branch, currentYear },
    changed: cleared.length > 0,
    cleared,
  };
}

/**
 * "B.Tech • Computer Science & Engineering • 2nd Year".
 * Mirrors the server-side formatter so profiles read identically everywhere, and
 * degrades for legacy users whose academic fields were cleared by the migration.
 * Surfaces with less room can drop parts: the directory shows course + year, and
 * the profile's academic tag shows the course alone.
 * @param {{ branch?: boolean, year?: boolean }} [parts] which segments to include
 * @returns {string|null}
 */
export function formatAcademic(courses, course, branch, currentYear, parts = {}) {
  const { branch: withBranch = true, year: withYear = true } = parts;
  const c = findCourse(courses, course);
  if (!c) return null;
  const b = c.branches.find((x) => x.id === branch);
  const out = [c.name];
  if (withBranch && b && b.id !== 'general') out.push(b.name);
  if (withYear && Number.isInteger(currentYear) && currentYear > 0) out.push(yearLabel(currentYear));
  return out.join(' • ');
}

/** Shared error copy — identical wording to the backend's ACADEMIC_ERRORS. */
export const ACADEMIC_ERRORS = {
  COURSE_REQUIRED: 'Please select your course.',
  BRANCH_REQUIRED: 'Please select your branch.',
  YEAR_REQUIRED: 'Please select your current year.',
  BRANCH_NOT_IN_COURSE: 'This branch is not available for the selected course.',
  YEAR_NOT_IN_COURSE: 'This year is not valid for the selected course.',
};

/** Client-side pre-submit check. The server re-validates regardless. */
export function validateAcademicSelection(courses, value) {
  if (!value?.course) return ACADEMIC_ERRORS.COURSE_REQUIRED;
  const course = findCourse(courses, value.course);
  if (!course) return ACADEMIC_ERRORS.COURSE_REQUIRED;
  if (!value.branch) return ACADEMIC_ERRORS.BRANCH_REQUIRED;
  if (!course.branches.some((b) => b.id === value.branch)) return ACADEMIC_ERRORS.BRANCH_NOT_IN_COURSE;
  if (!Number.isInteger(value.currentYear)) return ACADEMIC_ERRORS.YEAR_REQUIRED;
  if (value.currentYear < 1 || value.currentYear > course.durationYears) {
    return ACADEMIC_ERRORS.YEAR_NOT_IN_COURSE;
  }
  return null;
}
