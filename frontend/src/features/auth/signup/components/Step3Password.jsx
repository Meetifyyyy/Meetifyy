import React, { useState, useMemo } from 'react';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '@shared/context/AuthContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, AlertCircle, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step3Password() {
  const { signupData, updateData, nextStep } = useSignup();
  const { initiateSignup } = useAuth();
  const [password, setPassword] = useState(signupData.password || '');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [submitError, setSubmitError] = useState(null);

  const passwordError = useMemo(() => {
    if (!password) return "Password is required.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  }, [password]);

  const confirmError = useMemo(() => {
    if (!confirmPassword) return "Please confirm your password.";
    if (confirmPassword !== password) return "Passwords do not match.";
    return null;
  }, [confirmPassword, password]);

  const isValid = !passwordError && !confirmError;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);
    setSubmitError(null);
    if (isValid) {
      setIsSubmitting(true);
      try {
        const fullData = { ...signupData, password };
        updateData({ password });
        const success = await initiateSignup(fullData);
        if (success) {
          nextStep();
        }
      } catch (err) {
        const message = typeof err === 'string' ? err : (err?.message || 'Failed to initiate signup. Please try again.');
        setSubmitError(message);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <h2 className={styles.headline}>Set up a password</h2>
      <p className={styles.subheadline}>Keep your Meetifyy profile secure and private.</p>

      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div className={styles.inputGroup}>
          <div className={styles.inputWrapper}>
            <input
              id="choose-password"
              type={showPassword ? 'text' : 'password'}
              className={`${styles.largeInput} ${attempted && passwordError ? styles.inputError : ''}`}
              placeholder=" "
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ paddingRight: '2.75rem' }}
            />
            <label htmlFor="choose-password" className={styles.floatingLabel}>Choose Password</label>
            <button
              type="button"
              tabIndex={-1}
              className={styles.togglePassBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {attempted && passwordError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={13} /> {passwordError}</div>
          )}
        </div>

        <div className={styles.inputGroup}>
          <div className={styles.inputWrapper}>
            <input
              id="confirm-password"
              type="password"
              className={`${styles.largeInput} ${attempted && confirmError ? styles.inputError : ''}`}
              placeholder=" "
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <label htmlFor="confirm-password" className={styles.floatingLabel}>Confirm Password</label>
          </div>
          {attempted && confirmError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={13} /> {confirmError}</div>
          )}
        </div>

        {submitError && (
          <div className={styles.errorText} style={{ minHeight: 'auto', height: 'auto', whiteSpace: 'normal', color: 'var(--color-danger, #ef4444)' }}>
            <AlertCircle size={13} /> {submitError}
          </div>
        )}

        <button
          type="submit"
          className={styles.continueBtn}
          disabled={isSubmitting}
          style={{ width: '100%', justifyContent: 'center', marginTop: '1.25rem' }}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Creating account...</span>
            </>
          ) : (
            <>
              <span>Continue</span>
              <ArrowRight size={18} className={styles.btnIcon} />
            </>
          )}
        </button>
      </form>
    </AnimatedStep>
  );
}
