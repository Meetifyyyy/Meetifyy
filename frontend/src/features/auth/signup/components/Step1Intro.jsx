import { useState, useMemo } from 'react';
import { ArrowRight } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import { apiClient } from '@shared/api/apiClient';
import { checkEmailFormat, EMAIL_FORMAT, normalizeEmail } from '@shared/utils/emailValidation';
import { useAvailabilityCheck } from '../hooks/useAvailabilityCheck';
import { AuthHeading, AuthField, AuthButton, styles as s } from '../../shared/ui';

// What an API that predates personal-email signup says for an address outside
// every college domain. Signup no longer requires a college email (Campus is
// verified separately, on the Campus page), so that wording would send people
// looking for a college picker that no longer exists. Seen only while the
// frontend is ahead of its backend; replaced with a neutral sentence.
const LEGACY_COLLEGE_REQUIRED_REASON = 'Please select your college first.';
const LEGACY_COLLEGE_REQUIRED_MESSAGE =
  "This email can't be used to sign up right now. Please try another address.";

/** Same rules the old identity step used, now asked alongside the email. */
function validateName(name) {
  if (!name.trim()) return 'Please tell us your name.';
  if (/\d/.test(name)) return 'Names cannot contain numbers.';
  if (/[!@#$%^&*(),.?":{}|<>]/.test(name)) return 'Names cannot contain special characters.';
  if (name.trim().length < 2) return 'Please enter a valid name.';
  if (name.trim().length > 30) return 'Name cannot exceed 30 characters.';
  return null;
}

/**
 * Step 1 — name and email.
 *
 * Any email works: personal or college. Signing up with a college address does
 * NOT verify a college; Campus asks for that separately, on the Campus page.
 * The server still has to confirm the address is usable (well-formed, not
 * already registered, not a blocked domain) before the step advances.
 */
export default function Step1Intro() {
  const { signupData, updateData, nextStep } = useSignup();

  const [name, setName] = useState(
    signupData.firstName ? `${signupData.firstName} ${signupData.lastName || ''}`.trim() : '',
  );
  const [email, setEmail] = useState(signupData.email || '');
  const nameError = useMemo(() => validateName(name), [name]);
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
      ? 'Email is required.'
      : 'Please enter a valid email address.';

  const normalizedEmail = normalizeEmail(email);

  const {
    status: emailStatus,
    reason: emailReason,
    code: emailCode,
  } = useAvailabilityCheck(normalizedEmail, {
    endpoint: '/api/auth/check-email',
    field: 'email',
    enabled: emailFormat.valid,
  });

  const isChecking = emailStatus === 'checking';

  /**
   * One message per state, and every non-success state blocks.
   *
   * The four cases the old code collapsed into two:
   *
   *   format invalid       the user has not finished typing an address
   *   domain not allowed   a real address on a domain the server refuses
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
      if (emailCode === 'domain_not_allowed') {
        if (!emailReason || emailReason === LEGACY_COLLEGE_REQUIRED_REASON) return LEGACY_COLLEGE_REQUIRED_MESSAGE;
        return emailReason;
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

    if (nameError || emailFormatError) return;
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
              : res?.reason && res.reason !== LEGACY_COLLEGE_REQUIRED_REASON
                ? res.reason
                : LEGACY_COLLEGE_REQUIRED_MESSAGE,
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
    // and no `year`/`major` legacy keys. No college here: signup never decides
    // one, whatever the domain.
    const parts = name.trim().split(/\s+/);
    updateData({
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
      email: normalizedEmail,
    });
    nextStep();
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading
        title="Let's get you started"
        subtitle="Use any email you check. You can verify your college email later, on Campus."
      />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <AuthField
          id="signup-name"
          label="Your name"
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          maxLength={30}
          value={name}
          error={attempted ? nameError : null}
          onChange={(e) => setName(e.target.value.slice(0, 30))}
        />

        <AuthField
          id="signup-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          status={emailStatus}
          error={emailError}
          hint={emailHint}
          onChange={(e) => {
            setEmail(e.target.value);
            if (hardBlockReason) setHardBlockReason('');
          }}
        />

        <AuthButton
          type="submit"
          loading={isChecking || isSubmitting}
          loadingText="Checking..."
          disabled={emailDefinitelyBlocked}
          icon={<ArrowRight size={18} />}
          className={s.primaryAction}
        >
          Continue
        </AuthButton>
      </form>
    </AnimatedStep>
  );
}
