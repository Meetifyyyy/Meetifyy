import React, { useEffect, useMemo, useRef } from 'react';
import { AlertCircle } from '@shared/components/icons';
import { useAcademicCatalog } from './useAcademicCatalog';
import {
  branchesForCourse,
  validPassingYears,
  sanitizeAcademicSelection,
} from './academicCatalog';

/**
 * The Course, Passing Year and Branch dropdowns, shared by signup and settings.
 *
 * Controlled: the parent owns `value` and receives every change through
 * `onChange`.
 *
 * Layout:
 * - Row 1 (2 Columns): Course & Passing Year side-by-side (stacks smoothly on mobile)
 * - Row 2: Branch full width
 *
 * @param {{
 *   value: { course: string, branch: string, passingYear?: number|null, currentYear?: number|null },
 *   onChange: (next: { course: string, branch: string, passingYear: number|null }) => void,
 *   Select: React.ComponentType<any>,
 *   errors?: { course?: string|null, branch?: string|null, passingYear?: string|null, currentYear?: string|null },
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
  layout = 'stacked',
  divider = null,
  coursePlacement = 'top',
  branchPlacement = 'top',
  yearPlacement = 'top',
}) {
  const { courses, loading, error: catalogError } = useAcademicCatalog();

  const course = value?.course || '';
  const branch = value?.branch || '';
  const rawYear = value?.passingYear ?? value?.currentYear;
  const passingYear = Number.isInteger(rawYear) ? rawYear : null;

  const branchOptions = useMemo(
    () => branchesForCourse(courses, course).map((b) => ({ value: b.id, label: b.name })),
    [courses, course],
  );

  const yearOptions = useMemo(
    () => validPassingYears().map((y) => ({ value: String(y), label: String(y) })),
    [],
  );

  const courseOptions = useMemo(
    () => courses.map((c) => ({ value: c.id, label: c.name })),
    [courses],
  );

  const reconciled = useRef(false);
  useEffect(() => {
    if (loading || !courses.length || reconciled.current) return;
    reconciled.current = true;
    onCatalogReady?.(courses);
    const { value: clean, changed } = sanitizeAcademicSelection(courses, {
      course,
      branch,
      passingYear,
    });
    if (changed) {
      onChange(clean);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, courses]);

  const handleCourse = (nextCourse) => {
    const { value: clean } = sanitizeAcademicSelection(courses, {
      course: nextCourse,
      branch,
      passingYear,
    });
    onChange(clean);
  };

  const handleBranch = (nextBranch) => {
    onChange({ course, branch: nextBranch, passingYear });
  };

  const handlePassingYear = (nextYear) => {
    const parsed = /^\d+$/.test(String(nextYear)) ? parseInt(nextYear, 10) : null;
    onChange({ course, branch, passingYear: parsed });
  };

  const c = {
    group: classes.selectGroup || '',
    label: classes.selectLabel || '',
    slot: classes.messageSlot || '',
    message: classes.message || '',
    error: classes.messageError || '',
    divider: classes.divider || '',
  };

  const Message = ({ text }) =>
    showErrors && text ? (
      <div className={`${c.message} ${c.error}`} role="alert">
        <AlertCircle size={13} /> {text}
      </div>
    ) : null;

  const isDisabled = disabled || loading;

  const renderDivider = (key) => {
    if (divider) return <React.Fragment key={key}>{divider}</React.Fragment>;
    if (c.divider) return <div key={key} className={c.divider} />;
    return null;
  };

  const courseField = (
    <div className={c.group} key="academic-course-group">
      <label className={c.label} id="academic-course-label" htmlFor="academic-course-select">
        Course
      </label>
      <Select
        id="academic-course-select"
        value={course}
        onChange={handleCourse}
        placeholder={loading ? 'Loading courses…' : 'Select Course'}
        options={courseOptions}
        disabled={isDisabled}
        aria-labelledby="academic-course-label"
        placement={coursePlacement}
      />
      <div className={c.slot}><Message text={errors.course} /></div>
    </div>
  );

  const branchField = (
    <div className={c.group} key="academic-branch-group">
      <label className={c.label} id="academic-branch-label" htmlFor="academic-branch-select">
        Branch
      </label>
      <Select
        id="academic-branch-select"
        value={branch}
        onChange={handleBranch}
        placeholder={course ? 'Select Branch' : 'Select a course first'}
        options={branchOptions}
        disabled={isDisabled || !course}
        aria-labelledby="academic-branch-label"
        placement={branchPlacement}
      />
      <div className={c.slot}><Message text={errors.branch} /></div>
    </div>
  );

  const yearField = (
    <div className={c.group} key="academic-year-group">
      <label className={c.label} id="academic-year-label" htmlFor="academic-year-select">
        Passing Year
      </label>
      <Select
        id="academic-year-select"
        value={passingYear === null ? '' : String(passingYear)}
        onChange={handlePassingYear}
        placeholder="Select Passing Year"
        options={yearOptions}
        disabled={isDisabled}
        aria-labelledby="academic-year-label"
        placement={yearPlacement}
      />
      <div className={c.slot}><Message text={errors.passingYear ?? errors.currentYear} /></div>
    </div>
  );

  if (layout === 'grid') {
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', width: '100%', alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>{courseField}</div>
          <div style={{ minWidth: 0 }}>{yearField}</div>
        </div>
        {branchField}
        {catalogError ? (
          <div className={`${c.message} ${c.error}`} role="alert">
            <AlertCircle size={13} /> {catalogError}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem', width: '100%', alignItems: 'start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>{courseField}</div>
        <div style={{ flex: 1, minWidth: 0 }}>{yearField}</div>
      </div>
      {renderDivider('div-1')}
      {branchField}
      {renderDivider('div-2')}
      {catalogError ? (
        <div className={`${c.message} ${c.error}`} role="alert">
          <AlertCircle size={13} /> {catalogError}
        </div>
      ) : null}
    </>
  );
}
