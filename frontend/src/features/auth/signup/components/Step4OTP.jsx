import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mail, Check, AlertCircle } from 'lucide-react';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '@shared/context/AuthContext';
import AnimatedStep from './AnimatedStep';
import { AuthHeading, AuthButton, styles as s } from '../../shared/ui';

export default function Step4OTP() {
  const { signupData, nextStep } = useSignup();
  const { verifySignupOtp, resendSignupOtp } = useAuth();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('input'); // input -> verifying -> success
  const [timer, setTimer] = useState(59);
  const targetTimeRef = useRef(Date.now() + 59000);

  const inputsRef = useRef([]);
  const isVerifyingRef = useRef(false);

  // One interval for the component's lifetime, deriving remaining seconds from
  // targetTimeRef on every tick so a resend resumes cleanly without rebuilding
  // the interval.
  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((targetTimeRef.current - Date.now()) / 1000));
      setTimer(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);

    const handleVisibilityChange = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleResend = async () => {
    if (status === 'verifying') return;
    try {
      await resendSignupOtp(signupData.email);
      targetTimeRef.current = Date.now() + 59000;
      setTimer(59);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to resend code. Please try again.');
    }
  };

  const handleChange = (e, index) => {
    const val = e.target.value;
    if (isNaN(Number(val))) return;
    const newCode = [...code];
    newCode[index] = val.substring(val.length - 1);
    setCode(newCode);
    if (val && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const digits = e.clipboardData.getData('text/plain').trim().replace(/\D/g, '').slice(0, 6);
    if (digits.length > 0) {
      const newCode = [...code];
      for (let i = 0; i < digits.length; i++) newCode[i] = digits[i];
      setCode(newCode);
      inputsRef.current[Math.min(digits.length, 5)]?.focus();
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) inputsRef.current[index - 1]?.focus();
  };

  const isComplete = code.every((digit) => digit !== '');

  const handleVerify = useCallback(
    async (e) => {
      if (e) e.preventDefault();
      if (!isComplete || isVerifyingRef.current) return;

      isVerifyingRef.current = true;
      setStatus('verifying');
      setError(null);

      try {
        await verifySignupOtp(signupData.email, code.join(''), signupData);
        setStatus('success');
        setTimeout(() => nextStep(), 400);
      } catch (err) {
        setStatus('input');
        setError(err.message || 'Incorrect code. Please try again.');
      } finally {
        isVerifyingRef.current = false;
      }
    },
    [isComplete, code, nextStep, signupData, verifySignupOtp],
  );

  useEffect(() => {
    if (isComplete) handleVerify();
  }, [isComplete, handleVerify]);

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading
        title="Enter verification code"
        subtitle={
          <>
            We sent a 6-digit code to <strong>{signupData.email || 'your email'}</strong>
          </>
        }
      />

      {status === 'success' ? (
        <div className={s.statusBlock}>
          <span className={`${s.statusBadge} ${s.statusBadgeSuccess}`}>
            <Check size={30} />
          </span>
          <p style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-success)', margin: 0 }}>
            Email verified successfully!
          </p>
        </div>
      ) : (
        <form onSubmit={handleVerify} noValidate>
          <div className={s.otpRow}>
            {code.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => (inputsRef.current[idx] = el)}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(e, idx)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                onPaste={handlePaste}
                className={`${s.otpInput} ${error ? s.invalid : ''}`}
                disabled={status === 'verifying'}
                aria-label={`Digit ${idx + 1}`}
              />
            ))}
          </div>

          <div className={s.otpErrorRow}>
            {error ? (
              <span className={s.centerMessage}>
                <AlertCircle size={13} /> {error}
              </span>
            ) : null}
          </div>

          <div className={s.otpMeta}>
            {timer > 0 ? (
              <span className={s.otpTimer}>Resend code in {timer}s</span>
            ) : (
              <button type="button" className={s.resendBtn} onClick={handleResend} disabled={status === 'verifying'}>
                Resend verification code
              </button>
            )}

            <AuthButton
              type="submit"
              loading={status === 'verifying'}
              loadingText="Creating account..."
              disabled={!isComplete}
              icon={<Mail size={18} />}
            >
              Verify Code
            </AuthButton>
          </div>
        </form>
      )}
    </AnimatedStep>
  );
}
