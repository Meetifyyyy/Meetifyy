import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, AlertCircle } from '@shared/components/icons';
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

// Reason string the backend returns when the email domain is not linked to any
// registered college. We detect this to show a domain-specific error with a
// "request college" link rather than a generic "invalid email" message.
const DOMAIN_NOT_REGISTERED_REASON = 'Please select your college first.';

export default function Step2Academic() {
  const navigate = useNavigate();
  const { signupData, updateData, nextStep } = useSignup();

  const [email, setEmail] = useState(signupData.email || '');

  // One controlled object rather than three loose fields, so course/branch/year
  // can never drift out of sync with each other.
  const [academic, setAcademic] = useState(() => ({
    course: signupData.course || '',
    branch: signupData.branch || '',
    passingYear: Number.isInteger(signupData.passingYear ?? signupData.currentYear)
      ? (signupData.passingYear ?? signupData.currentYear)
      : null,
  }));
  const [attempted, setAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hardBlockReason, setHardBlockReason] = useState('');

  const emailFormatError = useMemo(() => {
    if (!email) return 'College email is required.';
    if (!email.includes('@')) return 'Enter a valid email address.';
    if (!emailRegex.test(email)) return 'Please enter a valid email address.';
    return null;
  }, [email]);

  const normalizedEmail = email.trim().toLowerCase();

  // No collegeId needed — the backend resolves college from the email domain.
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
    branch: !academic.branch ? ACADEMIC_ERRORS.BRANCH_REQUIRED : null,
    passingYear:
      !Number.isInteger(academic.passingYear) ? ACADEMIC_ERRORS.YEAR_REQUIRED : null,
  }), [academic]);

  const academicError = useMemo(
    () => validateAcademicSelection(academicCourses, academic),
    [academicCourses, academic],
  );

  const isChecking = emailStatus === 'checking';

  // True when the domain isn't linked to any registered college in the admin portal.
  const isDomainNotRegistered =
    emailStatus === 'taken' && emailReason === DOMAIN_NOT_REGISTERED_REASON;

  const emailError =
    isDomainNotRegistered
      ? null // handled separately below with the request link
      : emailStatus === 'taken'
        ? emailReason || 'This email is already registered. Please sign in.'
        : (attempted || email.includes('@')) && emailFormatError
          ? emailFormatError
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
        const res = await apiClient.post('/api/auth/check-email', {
          email: normalizedEmail,
        });
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

    // Persist the exact ids the backend validates against — no display strings,
    // and no `year`/`major` legacy keys. College is resolved server-side from
    // the email domain, so we do not store collegeId here.
    updateData({
      email: normalizedEmail,
      course: academic.course,
      branch: academic.branch,
      passingYear: academic.passingYear,
    });
    nextStep();
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="Academic details" />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        {/* College Email Field */}
        <AuthField
          id="signup-email"
          label="College Email"
          type="email"
          value={email}
          status={isDomainNotRegistered ? 'taken' : emailStatus}
          error={emailError}
          hint={emailHint}
          onChange={(e) => {
            setEmail(e.target.value);
            if (hardBlockReason) setHardBlockReason('');
          }}
        />

        {/* Domain-not-registered inline callout */}
        {isDomainNotRegistered && (
          <div
            className={`${s.message} ${s.messageError}`}
            role="alert"
            style={{
              marginTop: '-1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              flexWrap: 'wrap',
            }}
          >
            <AlertCircle size={13} style={{ flexShrink: 0 }} />
            <span>Your college isn&apos;t added yet.</span>
            <button
              type="button"
              onClick={() => navigate('/?request=college#join')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: '#5C47FA',
                fontWeight: 700,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 'inherit',
                lineHeight: 'inherit',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.2rem',
              }}
            >
              <span style={{ textDecoration: 'underline' }}>Request to add it</span>
              <ArrowRight size={12} style={{ flexShrink: 0 }} />
            </button>
          </div>
        )}

        {/* Course, Branch, and Current Year Selection */}
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
