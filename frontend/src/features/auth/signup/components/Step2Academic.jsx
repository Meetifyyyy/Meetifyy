import React, { useState, useMemo } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import CustomSelect from './CustomSelect';
import AcademicSelection from '@shared/academics/AcademicSelection';
import { useAcademicCatalog } from '@shared/academics/useAcademicCatalog';
import { validateAcademicSelection, ACADEMIC_ERRORS } from '@shared/academics/academicCatalog';
import { apiClient } from '@shared/api/apiClient';
import { useAvailabilityCheck } from '../hooks/useAvailabilityCheck';
import { AuthHeading, AuthField, AuthButton, styles as s } from '../../shared/ui';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Step2Academic() {
  const { signupData, updateData, nextStep } = useSignup();

  const [email, setEmail] = useState(signupData.email || '');
  // One controlled object rather than three loose fields, so course/branch/year
  // can never drift out of sync with each other.
  const [academic, setAcademic] = useState(() => ({
    course: signupData.course || '',
    branch: signupData.branch || '',
    currentYear: Number.isInteger(signupData.currentYear) ? signupData.currentYear : null,
  }));
  const [attempted, setAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hardBlockReason, setHardBlockReason] = useState('');

  const emailFormatError = useMemo(() => {
    if (!email) return 'College email is required.';
    if (!email.includes('@')) return 'Enter a valid email address.';
    if (!emailRegex.test(email)) return 'Please enter a valid email address.';
    const domain = email.split('@')[1] || '';
    if (!domain.endsWith('.edu') && !domain.endsWith('.ac.in') && !domain.endsWith('.org') && !domain.endsWith('.com')) {
      return 'Please enter a valid institution email.';
    }
    return null;
  }, [email]);

  const normalizedEmail = email.trim().toLowerCase();
  const { status: rawEmailStatus, reason: emailReason } = useAvailabilityCheck(normalizedEmail, {
    endpoint: '/api/auth/check-email',
    field: 'email',
    enabled: !emailFormatError,
  });
  const emailStatus = rawEmailStatus === 'network-error' ? 'network' : rawEmailStatus;

  const { courses: academicCourses } = useAcademicCatalog();

  // Per-field messages, derived from the one shared rule set so signup and
  // settings can never disagree about what is valid.
  const academicErrors = useMemo(() => ({
    course: !academic.course ? ACADEMIC_ERRORS.COURSE_REQUIRED : null,
    branch: academic.course && !academic.branch ? ACADEMIC_ERRORS.BRANCH_REQUIRED : null,
    currentYear:
      academic.course && !Number.isInteger(academic.currentYear) ? ACADEMIC_ERRORS.YEAR_REQUIRED : null,
  }), [academic]);

  const academicError = useMemo(
    () => validateAcademicSelection(academicCourses, academic),
    [academicCourses, academic],
  );

  const isChecking = emailStatus === 'checking';

  const emailError =
    attempted && emailFormatError
      ? emailFormatError
      : emailStatus === 'taken'
        ? emailReason || 'This email is already registered. Please sign in.'
        : hardBlockReason || null;
  const emailHint =
    emailStatus === 'network' ? "Couldn't verify — you can still continue." : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);
    setHardBlockReason('');

    if (emailFormatError || academicError) return;
    if (emailStatus === 'taken') return;

    // If the live check hasn't confirmed 'available' yet, run one authoritative
    // blocking check before advancing.
    if (emailStatus !== 'available') {
      setIsSubmitting(true);
      try {
        const res = await apiClient.post('/api/auth/check-email', { email: normalizedEmail });
        if (res?.available === false) {
          setHardBlockReason(res?.reason || 'This email is already registered. Please sign in.');
          setIsSubmitting(false);
          return;
        }
      } catch {
        // Network still down — proceed; the backend enforces conflicts at signup.
      }
      setIsSubmitting(false);
    }

    let university = 'University';
    const domain = normalizedEmail.split('@')[1] || '';
    const domainPart = domain.split('.')[0];
    if (domainPart) university = domainPart.charAt(0).toUpperCase() + domainPart.slice(1) + ' University';

    // Persist the exact ids the backend validates against — no display strings,
    // and no `year`/`major` legacy keys.
    updateData({
      email: normalizedEmail,
      course: academic.course,
      branch: academic.branch,
      currentYear: academic.currentYear,
      university,
    });
    nextStep();
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="Academic details" />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <AuthField
          id="signup-email"
          label="College Email"
          type="email"
          value={email}
          status={emailStatus}
          error={emailError}
          hint={emailHint}
          onChange={(e) => {
            setEmail(e.target.value);
            if (hardBlockReason) setHardBlockReason('');
          }}
        />

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

        <AuthButton
          type="submit"
          loading={isChecking || isSubmitting}
          loadingText="Checking..."
          icon={<ArrowRight size={18} />}
          style={{ marginTop: '0.5rem' }}
        >
          Continue
        </AuthButton>
      </form>
    </AnimatedStep>
  );
}
