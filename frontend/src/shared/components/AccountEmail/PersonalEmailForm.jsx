import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from '@shared/components/icons';
import OtpCodeInput, { useResendCountdown } from '@shared/components/OtpCodeInput';
import { accountEmailApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { describeAccountEmailError } from '@shared/lib/campusAccess';
import { checkEmailFormat } from '@shared/utils/emailValidation';
import { REAUTH_CANCELLED, useReauth } from './ReauthModal';
import { withReauth } from './withReauth';
import styles from './AccountEmail.module.css';

/**
 * Add or change the login (personal) email. Three steps, and there is no path
 * around any of them:
 *
 *   0. confirm it's you (ReauthModal: password, or an emailed code for an
 *      account without one) -> a single-use `personal_email_change` grant;
 *   1. the new address + the grant -> POST /api/account/email/otp (a code
 *      goes to the new address; the grant is bound to it);
 *   2. that code + the grant -> POST /api/account/email/verify.
 *
 * The verify body carries only the code and the grant; the server knows which
 * address the code went to, and re-checks the 30-day cooldown at both steps.
 * `currentUser.email` is updated from the verify response and nothing else.
 *
 * `onDone(email)` runs after a successful change; `onCancel` is optional.
 * `reauthFirst`: ask "confirm it's you" as soon as the form opens (Settings,
 * where the person just chose to change it), and treat declining as cancel.
 * Without it the dialog opens on "Send code", so a prompt shown unasked (the
 * profile-completion card) never greets anyone with a password dialog.
 */
export default function PersonalEmailForm({
  onDone,
  onCancel,
  submitLabel = 'Change email',
  cancelLabel = 'Cancel',
  alignActionsEnd = false,
  reauthFirst = false,
}) {
  const { currentUser, updateCurrentUser } = useAuth();
  const queryClient = useQueryClient();
  const { ensure, invalidate, modal: reauthModal } = useReauth('personal_email_change', {
    description: "For your security, confirm it's you before changing the email you sign in with.",
  });
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const cooldown = useResendCountdown(challenge?.resendAvailableAt);
  const busy = sending || verifying;

  // With `reauthFirst`, reauthentication comes before the new address is even
  // typed. `ensure` is stable, so this runs once, when the form opens.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    if (!reauthFirst) return;
    ensure().catch((err) => {
      if (err?.code === REAUTH_CANCELLED) onCancelRef.current?.();
    });
  }, [ensure, reauthFirst]);

  const send = useCallback(async () => {
    const normalized = email.trim().toLowerCase();
    if (!checkEmailFormat(normalized).valid) {
      setError('Enter a valid email address.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await withReauth({ ensure, invalidate }, (reauthToken) =>
        accountEmailApi.sendOtp({ email: normalized, reauthToken }),
      );
      setChallenge({
        emailMasked: res?.emailMasked || normalized,
        expiresAt: res?.expiresAt || null,
        resendAvailableAt: res?.resendAvailableAt || null,
      });
      setCode('');
    } catch (err) {
      if (err?.code !== REAUTH_CANCELLED) setError(describeAccountEmailError(err));
    } finally {
      setSending(false);
    }
  }, [email, ensure, invalidate]);

  const verify = useCallback(async () => {
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const res = await withReauth({ ensure, invalidate }, (reauthToken) =>
        accountEmailApi.verify({ code, reauthToken }),
      );
      // Spent by the change; the next one asks again.
      invalidate();
      // Settings → Email shows the cooldown this change just started.
      queryClient.invalidateQueries({ queryKey: ['account', 'email'] });
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
      onDone?.(nextEmail);
    } catch (err) {
      if (err?.code === REAUTH_CANCELLED) return;
      setError(describeAccountEmailError(err));
      if (err?.code === 'invalid_code' || err?.code === 'expired_code' || err?.code === 'too_many_attempts') {
        setCode('');
      }
    } finally {
      setVerifying(false);
    }
  }, [busy, code, ensure, invalidate, queryClient, currentUser, updateCurrentUser, onDone]);

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
      <>
      {reauthModal}
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
        <div className={`${styles.actions} ${alignActionsEnd ? styles.actionsEnd : ''}`}>
          {onCancel ? (
            <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
          ) : null}
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
        </div>
      </form>
      </>
    );
  }

  return (
    <>
    {reauthModal}
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        verify();
      }}
      noValidate
    >
      <p className={styles.text}>
        We sent a 6-digit code to <strong>{challenge.emailMasked}</strong>. Enter it
        here to confirm the change.
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
      <p className={styles.note}>
        From now on you sign in with this new email. We&apos;ll let your current address know.
      </p>
      {errorRow}
      <div className={`${styles.actions} ${alignActionsEnd ? styles.actionsEnd : ''}`}>
        {onCancel ? (
          <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        ) : null}
        <button type="submit" className={styles.primaryBtn} disabled={busy || code.length !== 6}>
          {verifying ? (
            <>
              <Loader2 size={16} className="spin" aria-hidden="true" />
              <span>Confirming…</span>
            </>
          ) : (
            <span>{submitLabel}</span>
          )}
        </button>
      </div>
    </form>
    </>
  );
}
