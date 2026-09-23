import { useState, useEffect, useRef, useCallback } from 'react';
import { Mail, AlertCircle } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '@shared/context/AuthContext';
import AnimatedStep from './AnimatedStep';
import { AuthHeading, AuthButton, styles as s } from '../../shared/ui';

export default function Step4OTP() {
  const { signupData } = useSignup();
  const { verifySignupOtp, resendSignupOtp } = useAuth();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('input'); // input -> verifying
  const [timer, setTimer] = useState(59);
  const targetTimeRef = useRef(Date.now() + 59000);

  const inputsRef = useRef([]);
  const isVerifyingRef = useRef(false);
  // The code most recently submitted by the auto-submit below. See there.
  const autoSubmittedCodeRef = useRef('');

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
        /*
         * Nothing to do here on success, and that is deliberate.
         *
         * Verification signs the user in, and SignupContext moves a signed-in
         * user to the last step itself — it has to, for a reload or a back
         * press. This step used to ALSO show a success badge and schedule its
         * own `nextStep()`, so one transition had two owners: the badge
         * painted for a single frame before the context replaced the step, and
         * the orphaned timer pushed the same step again 400ms later. That was
         * the flicker. The button keeps its spinner until the step is swapped.
         *
         * The latch stays set: the code is spent, and re-submitting it can
         * only fail.
         */
      } catch (err) {
        isVerifyingRef.current = false;
        setStatus('input');
        setError(err.message || 'Incorrect code. Please try again.');
      }
    },
    [isComplete, code, signupData, verifySignupOtp],
  );

  /**
   * Submits a completed code once.
   *
   * This used to fire whenever `handleVerify` changed identity with the code
   * still complete — and the sign-in that verification causes re-renders the
   * flow, which changes it. The same code was verified a second time the
   * moment the first succeeded, and the provider refused the spent code.
   * Keyed on the code itself, a code is submitted automatically once; a new
   * code after a failure is a new submission, and the button still resubmits.
   */
  useEffect(() => {
    const joined = code.join('');
    if (!isComplete || autoSubmittedCodeRef.current === joined) return;
    autoSubmittedCodeRef.current = joined;
    handleVerify();
  }, [isComplete, code, handleVerify]);

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

      <form onSubmit={handleVerify} noValidate>
        <div className={s.otpRow}>
          {code.map((digit, idx) => (
            <input
              key={idx}
              id={`otp-digit-${idx + 1}`}
              name={`otp-${idx + 1}`}
              ref={(el) => (inputsRef.current[idx] = el)}
              autoComplete={idx === 0 ? 'one-time-code' : 'off'}
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
    </AnimatedStep>
  );
}
