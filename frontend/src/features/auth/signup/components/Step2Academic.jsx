import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, AlertCircle } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import CustomSelect from './CustomSelect';
import AcademicSelection from '@shared/academics/AcademicSelection';
import { useAcademicCatalog } from '@shared/academics/useAcademicCatalog';
import { validateAcademicSelection, ACADEMIC_ERRORS } from '@shared/academics/academicCatalog';
import { apiClient } from '@shared/api/apiClient';
import { checkEmailFormat, EMAIL_FORMAT, normalizeEmail } from '@shared/utils/emailValidation';
import { useAvailabilityCheck } from '../hooks/useAvailabilityCheck';
import { AuthHeading, AuthField, AuthButton, styles as s } from '../../shared/ui';

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

  /**
   * Format first, and strictly.
   *
   * Nothing is asked of the server until the address is syntactically complete.
   * That ordering is the fix: a half-typed domain used to be sent anyway, the
   * server refused it as malformed, and the client read that refusal as a
   * connectivity problem and offered to continue regardless.
   */
  const emailFormat = useMemo(() => checkEmailFormat(email), [email]);
  const emailFormatError = emailFormat.valid
    ? null
    : emailFormat.code === EMAIL_FORMAT.REQUIRED
      ? 'College email is required.'
      : 'Please enter a valid email address.';

  const normalizedEmail = normalizeEmail(email);

  // No collegeId needed — the backend resolves college from the email domain.
  const {
    status: emailStatus,
    reason: emailReason,
    code: emailCode,
  } = useAvailabilityCheck(normalizedEmail, {
    endpoint: '/api/auth/check-email',
    field: 'email',
    enabled: emailFormat.valid,
  });

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
    emailStatus === 'rejected' &&
    emailCode === 'domain_not_allowed' &&
    emailReason === DOMAIN_NOT_REGISTERED_REASON;

  /**
   * One message per state, and every non-success state blocks.
   *
   * The four cases the old code collapsed into two:
   *
   *   format invalid       the user has not finished typing an address
   *   domain not allowed   a real address, but not an approved college domain
   *   already registered   sign in instead
   *   technical failure    we do not know; the user must retry, not proceed
   *
   * The last one used to be phrased as a reassurance and paired with an open
   * Continue button. An unverified address is not a verified one, and saying
   * otherwise let people past a gate the server would later refuse.
   */
  const emailError = (() => {
    // Format errors win: there is nothing to verify until the address is whole.
    // Shown once the user has typed an `@` (so it does not scold mid-word) or
    // once they have tried to submit.
    if (emailFormatError && (attempted || email.includes('@'))) {
      return emailFormatError;
    }
    if (emailFormatError) return null;

    if (emailStatus === 'rejected') {
      if (isDomainNotRegistered) return null; // rendered below with the request link
      if (emailCode === 'domain_not_allowed') {
        return emailReason || "This email domain isn't allowed. Please use your institution email.";
      }
      if (emailCode === 'invalid_email') return 'Please enter a valid email address.';
      return emailReason || 'This email is already registered. Please sign in.';
    }
    if (emailStatus === 'invalid') return 'Please enter a valid email address.';
    if (emailStatus === 'error') {
      return "We couldn't verify your email right now. Please check your connection and try again.";
    }
    return hardBlockReason || null;
  })();

  // No reassuring hint any more. Every failure is an error the user must resolve.
  const emailHint = null;

  /**
   * The single gate the Continue button and the submit handler both read.
   *
   * Requires a positive `available` from the server, not merely the absence of
   * a known failure — so 'checking', 'error' and a status that never resolved
   * all hold the step closed.
   */
  /**
   * Whether the email is in a state we know to be unusable.
   *
   * Distinct from "not yet verified": an untouched field is not a failure, and
   * the button stays live for it so a click can reveal the per-field errors the
   * form only shows after an attempt. Once the user has actually typed an
   * address that we know is bad — malformed, wrong domain, taken, or a check we
   * could not complete — the button closes, so there is no affordance
   * suggesting the step can be passed.
   */
  const emailDefinitelyBlocked =
    (email.includes('@') && !emailFormat.valid) ||
    emailStatus === 'rejected' ||
    emailStatus === 'invalid' ||
    emailStatus === 'error' ||
    Boolean(hardBlockReason);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);
    setHardBlockReason('');

    if (emailFormatError || academicError) return;
    // A settled "no" from the live check is final; do not re-ask.
    if (emailStatus === 'rejected' || emailStatus === 'invalid') return;

    // If the live check hasn't confirmed 'available' yet, run one authoritative
    // blocking check before advancing.
    if (emailStatus !== 'available') {
      setIsSubmitting(true);
      try {
        const res = await apiClient.post('/api/auth/check-email', {
          email: normalizedEmail,
        });
        if (res?.available !== true) {
          setHardBlockReason(
            res?.code === 'invalid_email'
              ? 'Please enter a valid email address.'
              : res?.reason || "This email domain isn't allowed. Please use your institution email.",
          );
          setIsSubmitting(false);
          return;
        }
      } catch (err) {
        /**
         * Blocked, not waved through.
         *
         * This catch used to fall through to `nextStep()` on the reasoning that
         * the backend enforces conflicts at signup anyway. It does — which is
         * precisely why continuing was wrong: the user would fill in a password
         * and an OTP before being told, three steps later, that their address
         * was never acceptable. And because a 400 for a malformed address
         * landed here too, a half-typed domain took the same path.
         */
        setHardBlockReason(
          err?.status >= 400 && err?.status < 500 && err?.status !== 429
            ? 'Please enter a valid email address.'
            : "We couldn't verify your email right now. Please check your connection and try again.",
        );
        setIsSubmitting(false);
        return;
      }
      setIsSubmitting(false);
    }

    // Last gate before advancing. Every path above either confirmed the address
    // with the server or set a blocking reason and returned, so reaching here
    // without a verified address would be a bug — this makes that unreachable
    // rather than merely unlikely.
    if (!emailFormat.valid) return;

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
          status={isDomainNotRegistered ? 'rejected' : emailStatus}
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
          disabled={emailDefinitelyBlocked}
          icon={<ArrowRight size={18} />}
          style={{ marginTop: '0.5rem' }}
        >
          Continue
        </AuthButton>
      </form>
    </AnimatedStep>
  );
}
