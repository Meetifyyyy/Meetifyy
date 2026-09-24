import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '@shared/context/AuthContext';
import AnimatedStep from './AnimatedStep';
import { AuthHeading, PasswordField, AuthButton, AuthAlert, styles as s } from '../../shared/ui';
import { validatePassword, PASSWORD_MIN_LENGTH } from '../../shared/passwordRules';

/**
 * Step 4 — password, and the agreement to the Terms.
 *
 * This is the step that creates the account (POST /signup, which also sends
 * the code), so the consent sits here, beside the button that acts on it,
 * rather than on the first screen before the person has decided anything.
 */
export default function Step4Password() {
  const { signupData, updateData, nextStep, pendingEmail, pendingPasswordRef, markCodeSent } = useSignup();
  const { initiateSignup } = useAuth();
  const [password, setPassword] = useState(signupData.password || '');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // Carried through `signupData` so it survives stepping back and forth.
  const [agreedToLegal, setAgreedToLegal] = useState(!!signupData.agreedToLegal);

  // Shared with the reset screen, so the two cannot word the same rule
  // differently or drift apart on the limits.
  const passwordError = useMemo(() => validatePassword(password), [password]);

  const confirmError = useMemo(() => {
    if (!confirmPassword) return 'Please confirm your password.';
    if (confirmPassword !== password) return 'Passwords do not match.';
    return null;
  }, [confirmPassword, password]);

  const isValid = !passwordError && !confirmError && agreedToLegal;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);
    setSubmitError(null);
    if (!isValid) return;

    updateData({ password, agreedToLegal: true });

    // A code already went to this exact address with this exact password (the
    // person went back from the verify step and returned unchanged). Signing
    // up again would only be refused as "already pending"; the code they have
    // is still the right one.
    const email = (signupData.email || '').trim().toLowerCase();
    if (email && email === pendingEmail && pendingPasswordRef.current === password) {
      nextStep();
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await initiateSignup({ ...signupData, password, agreedToLegal: true });
      if (success) {
        markCodeSent(email, password);
        nextStep();
      }
    } catch (err) {
      const message = typeof err === 'string' ? err : err?.message || 'Failed to initiate signup. Please try again.';
      // Already pending: a code was sent earlier, possibly with a different
      // password (or before a reload). Say exactly that, and offer the way on.
      setSubmitError(
        // initiateSignup rethrows without the status, so match the backend's
        // 409 wording ("A signup is already pending for this email").
        err?.status === 409 || /already pending/i.test(message)
          ? 'already-pending'
          : message,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="Create a password" subtitle="You'll log in with your username or college email and this password." />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <PasswordField
          id="signup-password"
          label="Password"
          autoComplete="new-password"
          value={password}
          error={attempted ? passwordError : null}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          onChange={(e) => setPassword(e.target.value)}
        />

        <PasswordField
          id="signup-confirm-password"
          label="Confirm password"
          autoComplete="new-password"
          value={confirmPassword}
          error={attempted ? confirmError : null}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />

        <label className={s.consentRow} htmlFor="signup-legal-consent">
          <input
            id="signup-legal-consent"
            type="checkbox"
            className={s.consentBox}
            aria-invalid={(attempted && !agreedToLegal) || undefined}
            aria-describedby="signup-legal-message"
            checked={agreedToLegal}
            onChange={(e) => setAgreedToLegal(e.target.checked)}
          />
          <span>
            I agree to the{' '}
            <Link to="/terms-and-conditions" target="_blank" rel="noopener noreferrer" className={s.consentLink}>
              Terms of Service
            </Link>{' '}
            and have read the{' '}
            <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer" className={s.consentLink}>
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <div className={s.messageSlot} id="signup-legal-message">
          {attempted && !agreedToLegal ? (
            <div className={`${s.message} ${s.messageError}`} role="alert">
              <AlertCircle size={14} aria-hidden="true" />
              <span>Please accept the Terms and Privacy Policy to continue.</span>
            </div>
          ) : null}
        </div>

        <AuthAlert tone={submitError === 'already-pending' ? 'warning' : 'error'}>
          {submitError === 'already-pending' ? (
            <>
              We already sent a code to this address.{' '}
              <button type="button" className={s.inlineAction} onClick={nextStep}>
                Enter the code
              </button>{' '}
              and log in later with the password you set first, or use a different email.
            </>
          ) : submitError}
        </AuthAlert>

        <AuthButton
          type="submit"
          loading={isSubmitting}
          loadingText="Creating your account..."
          icon={<ArrowRight size={18} />}
          className={s.primaryAction}
        >
          Create account
        </AuthButton>
      </form>
    </AnimatedStep>
  );
}
