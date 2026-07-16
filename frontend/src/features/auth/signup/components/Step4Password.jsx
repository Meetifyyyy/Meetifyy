import React, { useState, useMemo } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, AlertCircle, Lock, Eye, EyeOff } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step4Password() {
  const { signupData, updateData, nextStep } = useSignup();
  const [password, setPassword] = useState(signupData.password || '');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const passwordError = useMemo(() => {
    if (!password) return "Password is required.";
    if (password.length < 6) return "Password must be at least 6 characters.";
    return null;
  }, [password]);

  const confirmError = useMemo(() => {
    if (!confirmPassword) return "Please confirm your password.";
    if (confirmPassword !== password) return "Passwords do not match.";
    return null;
  }, [confirmPassword, password]);

  const isValid = !passwordError && !confirmError;

  const handleSubmit = (e) => {
    e.preventDefault();
    setAttempted(true);
    if (isValid) {
      updateData({ password });
      nextStep();
    }
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)', marginBottom: '1rem' }}>
        <Lock size={24} />
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Secure Account</span>
      </div>
      <h2 className={styles.headline}>Set up a password</h2>
      <p className={styles.subheadline}>Keep your Meetifyy profile secure and private.</p>

      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Choose Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              className={`${styles.largeInput} ${attempted && passwordError ? styles.inputError : ''}`}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ fontSize: '1.35rem', padding: '0.35rem 2.5rem 0.35rem 0', margin: '0.25rem 0 0 0' }}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: 0,
                top: '8px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-light)'
              }}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          {attempted && passwordError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={14} /> {passwordError}</div>
          )}
        </div>

        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Confirm Password</label>
          <input
            type="password"
            className={`${styles.largeInput} ${attempted && confirmError ? styles.inputError : ''}`}
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={{ fontSize: '1.35rem', padding: '0.35rem 0', margin: '0.25rem 0 0 0' }}
          />
          {attempted && confirmError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={14} /> {confirmError}</div>
          )}
        </div>

        <button 
          type="submit" 
          className={styles.continueBtn}
          style={{ width: '100%', justifyContent: 'center', marginTop: '1.5rem' }}
        >
          Continue <ArrowRight className={styles.btnIcon} />
        </button>
      </form>
    </AnimatedStep>
  );
}
