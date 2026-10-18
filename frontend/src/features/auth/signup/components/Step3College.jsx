import { useState, useMemo } from 'react';
import { ArrowRight } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import CustomSelect from './CustomSelect';
import AcademicSelection from '@shared/academics/AcademicSelection';
import { useAcademicCatalog } from '@shared/academics/useAcademicCatalog';
import { validateAcademicSelection, ACADEMIC_ERRORS } from '@shared/academics/academicCatalog';
import { AuthHeading, AuthButton, styles as s } from '../../shared/ui';

/**
 * Step 3 — what they study: course, branch and year.
 *
 * No college here. Signup never decides one (the email may be personal);
 * the college is proven later with a college email on the Campus page.
 * The ids saved are the exact ones the backend validates against.
 */
export default function Step3College() {
  const { signupData, updateData, nextStep } = useSignup();

  // One controlled object, so course/branch/year cannot drift apart.
  const [academic, setAcademic] = useState(() => ({
    course: signupData.course || '',
    branch: signupData.branch || '',
    passingYear: Number.isInteger(signupData.passingYear ?? signupData.currentYear)
      ? (signupData.passingYear ?? signupData.currentYear)
      : null,
  }));
  const [attempted, setAttempted] = useState(false);

  const { courses: academicCourses } = useAcademicCatalog();

  const academicErrors = useMemo(() => ({
    course: !academic.course ? ACADEMIC_ERRORS.COURSE_REQUIRED : null,
    branch: !academic.branch ? ACADEMIC_ERRORS.BRANCH_REQUIRED : null,
    passingYear: !Number.isInteger(academic.passingYear) ? ACADEMIC_ERRORS.YEAR_REQUIRED : null,
  }), [academic]);

  const academicError = useMemo(
    () => validateAcademicSelection(academicCourses, academic),
    [academicCourses, academic],
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    setAttempted(true);
    if (academicError) return;
    updateData({
      course: academic.course,
      branch: academic.branch,
      passingYear: academic.passingYear,
    });
    nextStep();
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="What are you studying?" subtitle="We use this to show you classmates and your batch." />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <AcademicSelection
          value={academic}
          onChange={setAcademic}
          Select={CustomSelect}
          errors={academicErrors}
          showErrors={attempted}
          classes={{
            selectGroup: s.selectGroup,
            selectLabel: s.selectLabel,
            messageSlot: s.messageSlot,
            message: s.message,
            messageError: s.messageError,
          }}
        />

        <AuthButton type="submit" icon={<ArrowRight size={18} />} className={s.primaryAction}>
          Continue
        </AuthButton>
      </form>
    </AnimatedStep>
  );
}
