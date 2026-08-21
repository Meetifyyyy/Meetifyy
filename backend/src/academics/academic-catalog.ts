/**
 * Canonical GLA University academic catalogue — the single source of truth for
 * Course → Branch → Current Year across signup, settings, profile and every
 * server-side validation. Nothing else in the codebase may define these lists.
 *
 * ─── Provenance ──────────────────────────────────────────────────────────────
 * Course and branch NAMES are taken verbatim from the official programme list at
 * https://www.gla.ac.in/courses. That page publishes a FLAT list of ~110 whole
 * programme names ("B.Tech CSE (Specialization in AIML)") — it does not model a
 * course/branch hierarchy. The split below is a mechanical parse of those names:
 * the degree family becomes the Course, the remainder becomes the Branch, and
 * the official wording is preserved in `name`.
 *
 * ─── Durations are NOT from GLA ──────────────────────────────────────────────
 * GLA publishes no course durations, on the index or on individual course pages.
 * `durationYears` therefore uses standard Indian programme lengths and is the one
 * field here that is not sourced from the university. It drives which Current Year
 * options are offered, so correct it here if the university differs — this is the
 * only place it is defined.
 *
 * Lateral-entry programmes are modelled as their own Course rather than a flag on
 * another, because students enter in year 2 and the programme runs one year
 * shorter; conflating them would let a lateral student pick an invalid year.
 */

export interface AcademicBranch {
  /** Stable identifier persisted in the database. Never render this to a user. */
  readonly id: string;
  /** Human-readable name, worded as GLA writes it. */
  readonly name: string;
}

export interface AcademicCourse {
  readonly id: string;
  readonly name: string;
  /** Number of academic years; also the maximum valid Current Year. */
  readonly durationYears: number;
  readonly branches: readonly AcademicBranch[];
}

/** A course with no published specialisations still needs one branch to select. */
const GENERAL: AcademicBranch = { id: 'general', name: 'General' };

export const ACADEMIC_CATALOG: readonly AcademicCourse[] = [
  // ── Undergraduate ──────────────────────────────────────────────────────────
  {
    id: 'btech',
    name: 'B.Tech',
    durationYears: 4,
    branches: [
      { id: 'cse', name: 'Computer Science & Engineering' },
      { id: 'cse-ai-analytics', name: 'CSE (Specialization in AI and Analytics)' },
      { id: 'cse-aiml', name: 'CSE (Specialization in AIML)' },
      { id: 'ece', name: 'Electronics & Communication Engineering' },
      { id: 'ec-minor-cs', name: 'Electronics & Communication (With Minor in Computer Science)' },
      { id: 'ec-vlsi', name: 'Electronics & Communication (With Specialization in VLSI)' },
      { id: 'electronics-computer', name: 'Electronics & Computer Engineering' },
      { id: 'ee', name: 'Electrical Engineering' },
      { id: 'ee-minor-cs', name: 'Electrical Engineering (With Minor in CS)' },
      { id: 'ee-ev', name: 'Electrical Engineering (With Specialization in Electric Vehicle Technology)' },
      { id: 'me', name: 'Mechanical Engineering' },
      { id: 'me-minor-cs', name: 'Mechanical Engineering (With Minor in CS)' },
      { id: 'me-automobile', name: 'Mechanical Engineering (Specialization in Automobile)' },
      { id: 'me-mechatronics', name: 'Mechanical Engineering (Specialization in Mechatronics)' },
      { id: 'civil', name: 'Civil Engineering' },
      { id: 'biotechnology', name: 'Biotechnology' },
    ],
  },
  {
    id: 'btech-lateral',
    name: 'B.Tech (Lateral Entry)',
    durationYears: 3,
    branches: [
      { id: 'cse', name: 'Computer Science & Engineering' },
      { id: 'ece', name: 'Electronics & Communication Engineering' },
      { id: 'ec-minor-cs', name: 'Electronics & Communication (With Minor in Computer Science)' },
      { id: 'ec-vlsi', name: 'Electronics & Communication (With Specialization in VLSI)' },
      { id: 'electronics-computer', name: 'Electronics & Computer Engineering' },
      { id: 'ee', name: 'Electrical Engineering' },
      { id: 'ee-ev', name: 'Electrical Engineering (With Specialization in Electric Vehicle Technology)' },
      { id: 'me', name: 'Mechanical Engineering' },
      { id: 'civil', name: 'Civil Engineering' },
      { id: 'biotechnology', name: 'Biotechnology' },
    ],
  },
  {
    id: 'bca',
    name: 'BCA',
    durationYears: 3,
    branches: [
      GENERAL,
      { id: 'data-science', name: 'Data Science' },
      { id: 'digital-marketing', name: 'Digital Marketing' },
      { id: 'aiml', name: 'AIML' },
    ],
  },
  {
    id: 'bba',
    name: 'BBA',
    durationYears: 3,
    branches: [
      GENERAL,
      { id: 'management-science', name: 'Management Science' },
      { id: 'family-business', name: 'Family Business' },
      { id: 'data-analytics-bi', name: 'Data Analytics and Business Intelligence' },
    ],
  },
  { id: 'bcom', name: 'B.Com', durationYears: 3, branches: [GENERAL] },
  {
    id: 'ba',
    name: 'B.A.',
    durationYears: 3,
    branches: [
      { id: 'economics', name: 'Economics' },
      { id: 'english', name: 'English' },
    ],
  },
  {
    id: 'bsc',
    name: 'B.Sc.',
    durationYears: 3,
    branches: [
      { id: 'biotechnology', name: 'Biotechnology' },
      { id: 'chemistry', name: 'Chemistry' },
      { id: 'physics', name: 'Physics' },
      { id: 'mathematics-data-science', name: 'Mathematics (Specialization in Data Science)' },
    ],
  },
  // Agriculture is a 4-year honours programme, unlike the other B.Sc. streams.
  { id: 'bsc-agriculture', name: 'B.Sc. (Hons.) Agriculture', durationYears: 4, branches: [GENERAL] },
  { id: 'bpharm', name: 'B. Pharm', durationYears: 4, branches: [GENERAL] },
  { id: 'bpharm-lateral', name: 'B. Pharm (Lateral Entry)', durationYears: 3, branches: [GENERAL] },
  { id: 'ba-llb', name: 'BA LLB (Hons.)', durationYears: 5, branches: [GENERAL] },
  { id: 'bba-llb', name: 'BBA LLB (Hons.)', durationYears: 5, branches: [GENERAL] },
  { id: 'bed', name: 'B.Ed.', durationYears: 2, branches: [GENERAL] },
  {
    id: 'bsc-bed-itep',
    name: 'B.Sc. B.Ed. (Integrated Teacher Education Programme)',
    durationYears: 4,
    branches: [GENERAL],
  },

  // ── Postgraduate ───────────────────────────────────────────────────────────
  {
    id: 'mtech',
    name: 'M.Tech',
    durationYears: 2,
    branches: [
      { id: 'cse', name: 'Computer Science & Engineering' },
      { id: 'ece', name: 'Electronics and Communications Engineering' },
      { id: 'ee', name: 'Electrical Engineering' },
      { id: 'structural', name: 'Structural Engineering' },
      { id: 'me-design', name: 'Mechanical Engineering (Design)' },
      { id: 'me-production', name: 'Mechanical Engineering (Production)' },
      { id: 'energy-systems', name: 'Energy Systems' },
      { id: 'transportation', name: 'Transportation Engineering' },
    ],
  },
  {
    id: 'mpharm',
    name: 'M. Pharm',
    durationYears: 2,
    branches: [
      { id: 'pharmaceutics', name: 'Pharmaceutics' },
      { id: 'pharmacology', name: 'Pharmacology' },
    ],
  },
  {
    id: 'mba',
    name: 'MBA',
    durationYears: 2,
    branches: [
      GENERAL,
      { id: 'hons', name: 'Hons.' },
      { id: 'logistics-scm', name: 'Logistics and Supply Chain Management' },
      { id: 'financial-markets-banking', name: 'Financial Markets & Banking' },
      { id: 'business-analytics', name: 'Business Analytics' },
    ],
  },
  {
    id: 'mca',
    name: 'MCA',
    durationYears: 2,
    branches: [GENERAL, { id: 'aiml', name: 'AIML' }],
  },
  {
    id: 'msc',
    name: 'M.Sc',
    durationYears: 2,
    branches: [
      { id: 'biotechnology', name: 'Biotechnology' },
      { id: 'microbiology-immunology', name: 'Microbiology & Immunology' },
      { id: 'chemistry', name: 'Chemistry' },
      { id: 'physics', name: 'Physics' },
      { id: 'mathematics', name: 'Mathematics' },
      { id: 'agriculture', name: 'Agriculture' },
    ],
  },
  { id: 'mcom', name: 'M.Com', durationYears: 2, branches: [GENERAL] },
  {
    id: 'llm',
    name: 'LLM',
    durationYears: 1,
    branches: [
      {
        id: 'banking-finance-cyber',
        name: 'Banking, Finance & Insurance Law and Cyber Law & Data Privacy Law',
      },
    ],
  },

  // ── Diploma ────────────────────────────────────────────────────────────────
  { id: 'dpharm', name: 'D. Pharm', durationYears: 2, branches: [GENERAL] },
  {
    id: 'diploma',
    name: 'Diploma',
    durationYears: 3,
    branches: [
      { id: 'cse', name: 'Computer Science Engineering' },
      { id: 'ece', name: 'Electronics & Communication' },
      { id: 'ee', name: 'Electrical Engineering' },
      { id: 'me', name: 'Mechanical Engineering' },
      { id: 'civil', name: 'Civil Engineering' },
    ],
  },

  // ── Doctoral ───────────────────────────────────────────────────────────────
  // Ph.D length is not fixed (typically 3-6 years). 6 is used as the upper bound
  // so a candidate in any year can describe themselves accurately.
  {
    id: 'phd',
    name: 'Ph.D',
    durationYears: 6,
    branches: [
      { id: 'computer-applications', name: 'Computer Applications' },
      { id: 'cse', name: 'Computer Science & Engineering' },
      { id: 'ece', name: 'Electronics & Communications Engineering' },
      { id: 'ee', name: 'Electrical Engineering' },
      { id: 'me', name: 'Mechanical Engineering' },
      { id: 'civil', name: 'Civil Engineering' },
      { id: 'biotechnology', name: 'Biotechnology' },
      { id: 'microbiology-immunology', name: 'Microbiology & Immunology' },
      { id: 'physics', name: 'Physics' },
      { id: 'chemistry', name: 'Chemistry' },
      { id: 'mathematics', name: 'Mathematics' },
      { id: 'english', name: 'English' },
      { id: 'law', name: 'Law' },
      { id: 'pharmacy', name: 'Pharmacy' },
      { id: 'management', name: 'Management' },
      { id: 'education', name: 'Education' },
      { id: 'agriculture', name: 'Agriculture' },
    ],
  },
] as const;

// ── Lookups ──────────────────────────────────────────────────────────────────

const COURSE_BY_ID = new Map<string, AcademicCourse>(
  ACADEMIC_CATALOG.map((c) => [c.id, c]),
);

export function findCourse(courseId: string | null | undefined): AcademicCourse | null {
  if (!courseId) return null;
  return COURSE_BY_ID.get(courseId) ?? null;
}

export function findBranch(
  courseId: string | null | undefined,
  branchId: string | null | undefined,
): AcademicBranch | null {
  const course = findCourse(courseId);
  if (!course || !branchId) return null;
  return course.branches.find((b) => b.id === branchId) ?? null;
}

/** Valid Current Year values for a course, e.g. [1,2,3,4] for B.Tech. */
export function validYearsForCourse(courseId: string | null | undefined): number[] {
  const course = findCourse(courseId);
  if (!course) return [];
  return Array.from({ length: course.durationYears }, (_, i) => i + 1);
}

export const YEAR_LABELS: Readonly<Record<number, string>> = {
  1: '1st Year',
  2: '2nd Year',
  3: '3rd Year',
  4: '4th Year',
  5: '5th Year',
  6: '6th Year',
};

export function yearLabel(year: number): string {
  return YEAR_LABELS[year] ?? `Year ${year}`;
}

/**
 * "B.Tech • Computer Science & Engineering • 2nd Year", omitting any part that is
 * missing so a partially-filled profile degrades instead of rendering "undefined".
 * Returns null when there is nothing meaningful to show.
 */
export function formatAcademicSummary(
  courseId: string | null | undefined,
  branchId: string | null | undefined,
  currentYear: number | null | undefined,
): string | null {
  const course = findCourse(courseId);
  if (!course) return null;
  const branch = findBranch(courseId, branchId);
  const parts = [course.name];
  // "General" carries no information next to the course name, so it is dropped.
  if (branch && branch.id !== GENERAL.id) parts.push(branch.name);
  if (typeof currentYear === 'number' && currentYear > 0) parts.push(yearLabel(currentYear));
  return parts.join(' • ');
}
