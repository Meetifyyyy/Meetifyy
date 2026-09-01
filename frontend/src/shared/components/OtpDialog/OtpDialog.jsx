import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { AlertCircle, Loader2, X } from '@shared/components/icons';
import styles from './OtpDialog.module.css';

const DIGITS = 6;

/**
 * Six-digit code entry, shared by the account-deletion and recovery flows.
 *
 * One component rather than two because the two flows differ only in their
 * words: the entry mechanics (paste a code from a mail client, backspace
 * between boxes, autofill from the OS) are fiddly enough that a second copy
 * would drift, and the security-relevant behaviour — never validating the code
 * locally, always surfacing the server's message verbatim — must not.
 *
 * Nothing here decides whether a code is right. It collects six digits, hands
 * them to `onSubmit`, and renders whatever the server says back. The countdowns
 * are driven from server-supplied absolute instants, so a device with a skewed
 * clock shows a wrong number of seconds but cannot shorten a real cooldown.
 */
export default function OtpDialog({
  title,
  description,
  maskedEmail,
  submitLabel,
  tone,
  challenge,
  onSubmit,
  onResend,
  onClose,
  busy,
}) {
  const [code, setCode] = useState(() => Array(DIGITS).fill(''));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const inputsRef = useRef([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  // Escape closes, matching every other dialog in the app.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const resendAt = challenge?.resendAvailableAt
    ? new Date(challenge.resendAvailableAt).getTime()
    : 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cooldownLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const expiresIn = useMemo(() => {
    if (!challenge?.expiresAt) return null;
    const ms = new Date(challenge.expiresAt).getTime() - now;
    return ms > 0 ? Math.ceil(ms / 60000) : 0;
  }, [challenge?.expiresAt, now]);

  const value = code.join('');
  const isComplete = value.length === DIGITS && code.every(Boolean);
  const disabled = busy || submitting || resending;

  const handleChange = (e, index) => {
    const raw = e.target.value;
    if (raw && Number.isNaN(Number(raw))) return;
    const next = [...code];
    next[index] = raw.slice(-1);
    setCode(next);
    setError(null);
    if (raw && index < DIGITS - 1) inputsRef.current[index + 1]?.focus();
  };

  // Pasting the whole code out of a mail client is how most people will enter
  // it, so it must fill every box rather than landing entirely in the first.
  const handlePaste = (e) => {
    e.preventDefault();
    const digits = e.clipboardData
      .getData('text/plain')
      .replace(/\D/g, '')
      .slice(0, DIGITS);
    if (!digits) return;
    const next = [...code];
    for (let i = 0; i < digits.length; i += 1) next[i] = digits[i];
    setCode(next);
    setError(null);
    inputsRef.current[Math.min(digits.length, DIGITS - 1)]?.focus();
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handleSubmit = useCallback(
    async (e) => {
      if (e) e.preventDefault();
      if (!isComplete || disabled) return;
      setSubmitting(true);
      setError(null);
      try {
        await onSubmit(value);
      } catch (err) {
        // The server's message is shown verbatim: it is the only thing that
        // knows whether the code was wrong, expired, or out of attempts, and
        // paraphrasing it here would let the two disagree.
        setError(err?.message || 'That code could not be verified.');
        setCode(Array(DIGITS).fill(''));
        inputsRef.current[0]?.focus();
      } finally {
        setSubmitting(false);
      }
    },
    [disabled, isComplete, onSubmit, value],
  );

  const handleResend = async () => {
    if (cooldownLeft > 0 || disabled) return;
    setResending(true);
    setError(null);
    try {
      await onResend();
      setCode(Array(DIGITS).fill(''));
      inputsRef.current[0]?.focus();
    } catch (err) {
      setError(err?.message || 'We could not send a new code.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onClick={() => !disabled && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={disabled}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <p className={styles.description}>
          {description}{' '}
          {maskedEmail && (
            <>
              We sent a {DIGITS}-digit code to{' '}
              <span className={styles.email}>{maskedEmail}</span>.
            </>
          )}
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.digits}>
            {code.map((digit, idx) => (
              <input
                // Index is the identity here: these are fixed positions, not a
                // reorderable list.
                key={idx}
                ref={(el) => {
                  inputsRef.current[idx] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                // Lets iOS and Android offer the code straight from the SMS or
                // mail notification.
                autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(e, idx)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                onPaste={handlePaste}
                disabled={disabled}
                aria-label={`Digit ${idx + 1}`}
                className={`${styles.digit} ${error ? styles.digitError : ''}`}
              />
            ))}
          </div>

          {/* Reserved height, so an error appearing does not shift the buttons
              out from under a finger already on its way down. */}
          <div className={styles.errorRow}>
            {error && (
              <span className={styles.error} role="alert">
                <AlertCircle size={14} />
                {error}
              </span>
            )}
          </div>

          <div className={styles.meta}>
            {expiresIn !== null && expiresIn > 0 && (
              <span>Code expires in {expiresIn} min</span>
            )}
            {cooldownLeft > 0 ? (
              <span>Resend in {cooldownLeft}s</span>
            ) : (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={handleResend}
                disabled={disabled}
              >
                {resending ? 'Sending…' : 'Send a new code'}
              </button>
            )}
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={onClose}
              disabled={disabled}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.primaryBtn} ${tone === 'danger' ? styles.dangerBtn : ''}`}
              disabled={!isComplete || disabled}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Verifying…</span>
                </>
              ) : (
                <span>{submitLabel}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

OtpDialog.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  maskedEmail: PropTypes.string,
  submitLabel: PropTypes.string.isRequired,
  /** 'danger' renders the confirm button in the destructive colour. */
  tone: PropTypes.oneOf(['default', 'danger']),
  challenge: PropTypes.shape({
    expiresAt: PropTypes.string,
    resendAvailableAt: PropTypes.string,
  }),
  onSubmit: PropTypes.func.isRequired,
  onResend: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  busy: PropTypes.bool,
};

OtpDialog.defaultProps = {
  tone: 'default',
};
