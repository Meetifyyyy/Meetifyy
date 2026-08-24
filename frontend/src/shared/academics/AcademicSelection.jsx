import React, { useEffect, useMemo, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAcademicCatalog } from './useAcademicCatalog';
import {
  branchesForCourse,
  yearsForCourse,
  yearLabel,
  sanitizeAcademicSelection,
} from './academicCatalog';

/**
 * The Course → Branch → Current Year dropdowns, shared by signup and settings so
 * the dependent-selection rules exist in exactly one place.
 *
 * Controlled: the parent owns `value` and receives every change through
 * `onChange`. The component enforces the dependency rules itself — changing the
 * course clears a branch that no longer belongs to it and a year the new course
 * is too short for — so no caller has to remember to do that.
 *
 * @param {{
 *   value: { course: string, branch: string, currentYear: number|null },
 *   onChange: (next: { course: string, branch: string, currentYear: number|null }) => void,
 *   Select: React.ComponentType<any>,
 *   errors?: { course?: string|null, branch?: string|null, currentYear?: string|null },
 *   showErrors?: boolean,
 *   disabled?: boolean,
 *   classes?: Record<string, string>,
 *   onCatalogReady?: (courses: any[]) => void,
 * }} props
 */
export default function AcademicSelection({
  value,
  onChange,
  Select,
  errors = {},
  showErrors = false,
  disabled = false,
  classes = {},
  onCatalogReady,
}) {
  const { courses, loading, error: catalogError } = useAcademicCatalog();

  const course = value?.course || '';
  const branch = value?.branch || '';
  const currentYear = Number.isInteger(value?.currentYear) ? value.currentYear : null;

  const branchOptions = useMemo(
    () => branchesForCourse(courses, course).map((b) => ({ value: b.id, label: b.name })),
    [courses, course],
  );
  const yearOptions = useMemo(
    () => yearsForCourse(courses, course).map((y) => ({ value: String(y), label: yearLabel(y) })),
    [courses, course],
  );
  const courseOptions = useMemo(
    () => courses.map((c) => ({ value: c.id, label: c.name })),
    [courses],
  );

  // Once the catalogue arrives, reconcile whatever the parent restored (from a
  // signup draft or a saved profile) against it. Anything no longer valid is
  // cleared rather than displayed, so the UI never shows a selection the server
  // would reject. Runs only on the transition to "loaded" — never on user input.
  const reconciled = useRef(false);
  useEffect(() => {
    if (loading || !courses.length || reconciled.current) return;
    reconciled.current = true;
    onCatalogReady?.(courses);
    const { value: clean, changed } = sanitizeAcademicSelection(courses, {
      course,
      branch,
      currentYear,
    });
    if (changed) onChange(clean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, courses]);

  const handleCourse = (nextCourse) => {
    if (nextCourse === course) return;
    // Re-derive dependants against the NEW course rather than blindly clearing:
    // a student switching B.Tech → B.Tech (Lateral Entry) keeps their branch and
    // their year if both still exist there.
    const { value: clean } = sanitizeAcademicSelection(courses, {
      course: nextCourse,
      branch,
      currentYear,
    });
    onChange(clean);
  };

  const handleBranch = (nextBranch) => onChange({ course, branch: nextBranch, currentYear });

  const handleYear = (nextYear) => {
    const parsed = /^\d+$/.test(String(nextYear)) ? parseInt(nextYear, 10) : null;
    onChange({ course, branch, currentYear: parsed });
  };

  const c = {
    group: classes.selectGroup || '',
    label: classes.selectLabel || '',
    slot: classes.messageSlot || '',
    message: classes.message || '',
    error: classes.messageError || '',
    row: classes.row || '',
  };

  const Message = ({ text }) =>
    showErrors && text ? (
      <div className={`${c.message} ${c.error}`} role="alert">
        <AlertCircle size={13} /> {text}
      </div>
    ) : null;

  const isDisabled = disabled || loading;

  return (
    <>
      {catalogError ? (
        <div className={`${c.message} ${c.error}`} role="alert">
          <AlertCircle size={13} /> {catalogError}
        </div>
      ) : null}

      <div className={c.group}>
        <span className={c.label} id="academic-course-label">Course</span>
        <Select
          value={course}
          onChange={handleCourse}
          placeholder={loading ? 'Loading courses…' : 'Select Course'}
          options={courseOptions}
          disabled={isDisabled}
          aria-labelledby="academic-course-label"
        />
        <div className={c.slot}><Message text={errors.course} /></div>
      </div>

      <div className={c.group}>
        <span className={c.label} id="academic-branch-label">Branch</span>
        <Select
          value={branch}
          onChange={handleBranch}
          /* Disabled until a course is chosen — there is nothing valid to pick yet. */
          placeholder={course ? 'Select Branch' : 'Select a course first'}
          options={branchOptions}
          disabled={isDisabled || !course}
          aria-labelledby="academic-branch-label"
        />
        <div className={c.slot}><Message text={errors.branch} /></div>
      </div>

      <div className={c.group}>
        <span className={c.label} id="academic-year-label">Current Year</span>
        <Select
          value={currentYear === null ? '' : String(currentYear)}
          onChange={handleYear}
          placeholder={course ? 'Select Year' : 'Select a course first'}
          options={yearOptions}
          disabled={isDisabled || !course}
          aria-labelledby="academic-year-label"
        />
        <div className={c.slot}><Message text={errors.currentYear} /></div>
      </div>
    </>
  );
}
