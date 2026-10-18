import { useCallback, useState } from 'react';
import { AlertCircle, Loader2 } from '@shared/components/icons';
import OtpCodeInput, { useResendCountdown } from '@shared/components/OtpCodeInput';
import { accountEmailApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { describeAccountEmailError } from '@shared/lib/campusAccess';
import { checkEmailFormat } from '@shared/utils/emailValidation';
import styles from './AccountEmail.module.css';

/**
 * Add or change the login (personal) email. Always two steps, and there is no
 * path around the second:
 *
 *   1. the new address -> POST /api/account/email/otp (a code goes to it)
 *   2. that code + the current password -> POST /api/account/email/verify
 *
 * The verify body carries only the code and the password; the server knows
 * which address the code went to. `currentUser.email` is updated from the
 * verify response and nothing else.
 *
 * `onDone(email)` runs after a successful change; `onCancel` is optional.
 */
export default function PersonalEmailForm({ onDone, onCancel, submitLabel = 'Change email' }) {
  const { currentUser, updateCurrentUser } = useAuth();
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const cooldown = useResendCountdown(challenge?.resendAvailableAt);
  const busy = sending || verifying;

  const send = useCallback(async () => {
    const normalized = email.trim().toLowerCase();
    if (!checkEmailFormat(normalized).valid) {
      setError('Enter a valid email address.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await accountEmailApi.sendOtp({ email: normalized });
      setChallenge({
        emailMasked: res?.emailMasked || normalized,
        expiresAt: res?.expiresAt || null,
        resendAvailableAt: res?.resendAvailableAt || null,
      });
      setCode('');
    } catch (err) {
      setError(describeAccountEmailError(err));
    } finally {
      setSending(false);
    }
  }, [email]);

  const verify = useCallback(async () => {
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    if (!password) {
      setError('Enter your current password.');
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const res = await accountEmailApi.verify({ code, currentPassword: password });
      const nextEmail = res?.email;
      if (nextEmail && currentUser && updateCurrentUser) {
        updateCurrentUser({
          ...currentUser,
          email: nextEmail,
          profileCompletion: currentUser.profileCompletion
            ? { ...currentUser.profileCompletion, needsPersonalEmail: false }
            : currentUser.profileCompletion,
        });
      }
      setPassword('');
      onDone?.(nextEmail);
    } catch (err) {
      setError(describeAccountEmailError(err));
      if (err?.code === 'invalid_code' || err?.code === 'expired_code' || err?.code === 'too_many_attempts') {
        setCode('');
      }
    } finally {
      setVerifying(false);
    }
  }, [busy, code, password, currentUser, updateCurrentUser, onDone]);

  const errorRow = (
    <div className={styles.error} role="alert" aria-live="polite">
      {error ? (
        <>
          <AlertCircle size={14} aria-hidden="true" />
          <span>{error}</span>
        </>
      ) : null}
    </div>
  );

  if (!challenge) {
    return (
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        noValidate
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="personal-email-input">
            Personal email
          </label>
          <input
            id="personal-email-input"
            className={styles.input}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@gmail.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            disabled={busy}
          />
        </div>
        <p className={styles.note}>
          After the change you sign in with this email. Your college email stays on your account
          for Campus.
        </p>
        {errorRow}
        <div className={styles.actions}>
          <button type="submit" className={styles.primaryBtn} disabled={busy || !email.trim()}>
            {sending ? (
              <>
                <Loader2 size={16} className="spin" aria-hidden="true" />
                <span>Sending…</span>
              </>
            ) : (
              <span>Send code</span>
            )}
          </button>
          {onCancel ? (
            <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        verify();
      }}
      noValidate
    >
      <p className={styles.text}>
        We sent a 6-digit code to <strong>{challenge.emailMasked}</strong>. Enter it with your current
        password to confirm the change.
      </p>
      <OtpCodeInput
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        disabled={verifying}
        invalid={Boolean(error)}
        autoFocus
        idPrefix="personal-email-otp"
      />
      <div className={styles.meta}>
        {cooldown > 0 ? (
          <span>Resend in {cooldown}s</span>
        ) : (
          <button type="button" className={styles.linkBtn} onClick={send} disabled={busy}>
            {sending ? 'Sending…' : 'Send a new code'}
          </button>
        )}
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => {
            setChallenge(null);
            setCode('');
            setError(null);
          }}
          disabled={busy}
        >
          Use a different email
        </button>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="personal-email-password">
          Current password
        </label>
        <input
          id="personal-email-password"
          className={styles.input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          disabled={verifying}
        />
      </div>
      <p className={styles.note}>From now on you sign in with this new email.</p>
      {errorRow}
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryBtn} disabled={busy || code.length !== 6 || !password}>
          {verifying ? (
            <>
              <Loader2 size={16} className="spin" aria-hidden="true" />
              <span>Confirming…</span>
            </>
          ) : (
            <span>{submitLabel}</span>
          )}
        </button>
        {onCancel ? (
          <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
