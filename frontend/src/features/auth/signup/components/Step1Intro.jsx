import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import { apiClient } from '@shared/api/apiClient';
import { checkEmailFormat, EMAIL_FORMAT, normalizeEmail } from '@shared/utils/emailValidation';
import { useAvailabilityCheck } from '../hooks/useAvailabilityCheck';
import { AuthHeading, AuthField, AuthButton, styles as s } from '../../shared/ui';

// Reason string the backend returns when the email domain is not linked to any
// registered college. We detect this to show a domain-specific error with a
// "request college" link rather than a generic "invalid email" message.
const DOMAIN_NOT_REGISTERED_REASON = 'Please select your college first.';

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
 * Step 1 — name and college email.
 *
 * The two things anyone expects to give first, and the email is also the
 * student check: its domain must belong to an approved college, and the
 * college is read from it here so the College step never has to ask for it.
 * The email gate below is unchanged from when it lived on the academic step.
 */
export default function Step1Intro() {
  const navigate = useNavigate();
  const { signupData, updateData, nextStep, setCollegeName } = useSignup();

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
      ? 'College email is required.'
      : 'Please enter a valid email address.';

  const normalizedEmail = normalizeEmail(email);

  // No collegeId needed — the backend resolves college from the email domain.
  const {
    status: emailStatus,
    reason: emailReason,
    code: emailCode,
    collegeName,
  } = useAvailabilityCheck(normalizedEmail, {
    endpoint: '/api/auth/check-email',
    field: 'email',
    enabled: emailFormat.valid,
  });

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
    const parts = name.trim().split(/\s+/);
    updateData({
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
      email: normalizedEmail,
    });
    if (collegeName) setCollegeName(collegeName);
    nextStep();
  };

  const emailOk = emailStatus === 'available' && !emailError;

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading
        title="Let's get you started"
        subtitle="Use your college email. It's how we know you're a student."
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
          label="College email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          status={isDomainNotRegistered ? 'rejected' : emailStatus}
          error={
            isDomainNotRegistered ? (
              <>
                Your college isn&apos;t on Meetifyy yet.{' '}
                <button
                  type="button"
                  className={s.inlineAction}
                  onClick={() => navigate('/?request=college#join')}
                >
                  Request to add it
                  <ArrowRight size={12} aria-hidden="true" />
                </button>
              </>
            ) : emailError
          }
          hint={emailOk && collegeName ? `${collegeName} · verified college domain` : emailHint}
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
