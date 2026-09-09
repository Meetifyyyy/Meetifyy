import { useState, useMemo } from 'react';
import { AlertCircle, ArrowRight } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '@shared/context/AuthContext';
import AnimatedStep from './AnimatedStep';
import { AuthHeading, PasswordField, AuthButton, styles as s } from '../../shared/ui';
import { validatePassword } from '../../shared/passwordRules';

export default function Step3Password() {
  const { signupData, updateData, nextStep } = useSignup();
  const { initiateSignup } = useAuth();
  const [password, setPassword] = useState(signupData.password || '');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Shared with the reset screen, so the two cannot word the same rule
  // differently or drift apart on the limits.
  const passwordError = useMemo(() => validatePassword(password), [password]);

  const confirmError = useMemo(() => {
    if (!confirmPassword) return 'Please confirm your password.';
    if (confirmPassword !== password) return 'Passwords do not match.';
    return null;
  }, [confirmPassword, password]);

  const isValid = !passwordError && !confirmError;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);
    setSubmitError(null);
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      updateData({ password });
      const success = await initiateSignup({ ...signupData, password });
      if (success) nextStep();
    } catch (err) {
      const message = typeof err === 'string' ? err : err?.message || 'Failed to initiate signup. Please try again.';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="Set up a password" />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <PasswordField
          id="signup-password"
          label="Choose Password"
          autoComplete="new-password"
          value={password}
          error={attempted ? passwordError : null}
          onChange={(e) => setPassword(e.target.value)}
        />

        <PasswordField
          id="signup-confirm-password"
          label="Confirm Password"
          autoComplete="new-password"
          value={confirmPassword}
          error={attempted ? confirmError : null}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />

        {submitError ? (
          <div className={`${s.banner} ${s.bannerError}`}>
            <AlertCircle size={15} />
            <span>{submitError}</span>
          </div>
        ) : null}

        <AuthButton
          type="submit"
          loading={isSubmitting}
          loadingText="Creating account..."
          icon={<ArrowRight size={18} />}
          style={{ marginTop: '0.75rem' }}
        >
          Continue
        </AuthButton>
      </form>
    </AnimatedStep>
  );
}
