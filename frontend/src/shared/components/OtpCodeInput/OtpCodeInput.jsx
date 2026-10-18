import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import styles from './OtpCodeInput.module.css';

const DIGITS = 6;

/**
 * Six boxes for an emailed code, inline (OtpDialog is the modal version).
 *
 * Controlled: `value` is the code as a string, `onChange` receives the new
 * string. `onComplete` fires once per distinct complete code, so a finished
 * code submits itself without a second submission when the parent re-renders.
 * Nothing here judges the code; the server does.
 */
export default function OtpCodeInput({ value, onChange, onComplete, disabled, invalid, autoFocus, idPrefix }) {
  const inputsRef = useRef([]);
  const lastCompleted = useRef('');
  const digits = Array.from({ length: DIGITS }, (_, i) => value[i] || '');

  useEffect(() => {
    if (autoFocus) inputsRef.current[0]?.focus({ preventScroll: true });
  }, [autoFocus]);

  // Cleared by the parent (a wrong code): typing starts again from the first box.
  useEffect(() => {
    if (value !== '') return;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && inputsRef.current.includes(active) && active !== inputsRef.current[0]) {
      inputsRef.current[0]?.focus({ preventScroll: true });
    }
  }, [value]);

  useEffect(() => {
    if (value.length === DIGITS && /^\d{6}$/.test(value)) {
      if (lastCompleted.current !== value) {
        lastCompleted.current = value;
        onComplete?.(value);
      }
    } else {
      lastCompleted.current = '';
    }
  }, [value, onComplete]);

  const setAt = (index, digit) => {
    const next = [...digits];
    next[index] = digit;
    onChange(next.join('').slice(0, DIGITS));
  };

  const handleChange = (e, index) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (e.target.value && !raw) return;
    if (raw.length > 1) {
      // Autofill or a fast typist: spread the digits forward.
      const next = [...digits];
      for (let i = 0; i < raw.length && index + i < DIGITS; i += 1) next[index + i] = raw[i];
      onChange(next.join(''));
      inputsRef.current[Math.min(index + raw.length, DIGITS - 1)]?.focus({ preventScroll: true });
      return;
    }
    setAt(index, raw);
    if (raw && index < DIGITS - 1) inputsRef.current[index + 1]?.focus({ preventScroll: true });
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/plain').replace(/\D/g, '').slice(0, DIGITS);
    if (!pasted) return;
    onChange(pasted);
    inputsRef.current[Math.min(pasted.length, DIGITS - 1)]?.focus({ preventScroll: true });
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus({ preventScroll: true });
    }
  };

  return (
    <div className={styles.digits} role="group" aria-label="Verification code">
      {digits.map((digit, idx) => (
        <input
          // Fixed positions, not a reorderable list.
          key={idx}
          id={idPrefix ? `${idPrefix}-${idx + 1}` : undefined}
          ref={(el) => {
            inputsRef.current[idx] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={idx === 0 ? 'one-time-code' : 'off'}
          maxLength={idx === 0 ? DIGITS : 1}
          value={digit}
          onChange={(e) => handleChange(e, idx)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          onPaste={handlePaste}
          disabled={disabled}
          aria-label={`Digit ${idx + 1}`}
          aria-invalid={invalid || undefined}
          className={`${styles.digit} ${invalid ? styles.digitError : ''}`}
        />
      ))}
    </div>
  );
}

OtpCodeInput.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onComplete: PropTypes.func,
  disabled: PropTypes.bool,
  invalid: PropTypes.bool,
  autoFocus: PropTypes.bool,
  idPrefix: PropTypes.string,
};

/**
 * Seconds until a resend is allowed, counted down from the server's absolute
 * `resendAvailableAt`, so a skewed device clock cannot shorten a real cooldown
 * (it can only show the wrong number).
 */
export function useResendCountdown(resendAvailableAt) {
  const target = resendAvailableAt ? new Date(resendAvailableAt).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  return Number.isFinite(target) ? Math.max(0, Math.ceil((target - now) / 1000)) : 0;
}
