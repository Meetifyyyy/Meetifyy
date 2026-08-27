import { useMemo } from 'react';
import { useAcademicCatalog } from './useAcademicCatalog';
import { formatAcademic } from './academicCatalog';

/**
 * Renders a user's academic info as one display string:
 *   "B.Tech • Computer Science & Engineering • 2nd Year"
 *
 * Replaces the per-file `formatMajor` helpers that each parsed the old free-text
 * `major` differently, so every surface now words it identically.
 *
 * Returns null when the user has no usable academic data — which includes legacy
 * accounts whose Major/Year-of-Pass was dropped by the migration. Callers should
 * treat null as "render nothing" rather than showing a placeholder.
 *
 * Pass `parts` to drop segments on tighter surfaces, e.g. `{ branch: false }`
 * for "B.Tech • 2nd Year" or `{ branch: false, year: false }` for "B.Tech".
 *
 * @param {{ course?: string|null, branch?: string|null, passingYear?: number|null, currentYear?: number|null }|null|undefined} user
 * @param {{ branch?: boolean, year?: boolean }} [parts]
 * @returns {string|null}
 */
export function useAcademicSummary(user, parts = {}) {
  const { courses } = useAcademicCatalog();
  const { branch: withBranch = true, year: withYear = true } = parts;
  const yearVal = user?.passingYear ?? user?.currentYear;
  return useMemo(
    () => formatAcademic(courses, user?.course, user?.branch, yearVal, {
      branch: withBranch,
      year: withYear,
    }),
    [courses, user?.course, user?.branch, yearVal, withBranch, withYear],
  );
}
