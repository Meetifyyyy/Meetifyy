import { useCallback, useState } from 'react';
import { REAUTH_CANCELLED, useReauth } from '@shared/components/AccountEmail/ReauthModal';
import { withReauth } from '@shared/components/AccountEmail/withReauth';
import { AlertCircle, Loader2 } from '@shared/components/icons';
import OtpCodeInput, { useResendCountdown } from '@shared/components/OtpCodeInput';
import { useCampusAffiliationActions } from '@shared/hooks/useCampusAffiliationActions';
import { describeCampusOtpError } from '@shared/lib/campusAccess';
import { checkEmailFormat } from '@shared/utils/emailValidation';
import { showToast } from '@shared/utils/toast';
import CollegeLogo from './CollegeLogo';
import styles from './CampusAffiliation.module.css';

/**
 * Step two of joining Campus: prove the college email.
 *
 * `initialChallenge` is a code already sent (restored from the server's
 * `pending` after a reload). Its full address is not known here, only the
 * masked one, so a resend from that state asks for the address again.
 *
 * An account's first college email needs only the code. Any later one (a
 * change, or adding one back after removing it) also needs "confirm it's
 * you": the server answers `reauth_required` and the dialog opens, then the
 * same request is retried. The server also enforces the 30-day cooldown.
 */
export default function CollegeEmailVerify({ college, initialChallenge = null, onChangeCollege, onVerified }) {
  const { sendCode, verifyCode } = useCampusAffiliationActions();
  const reauth = useReauth('college_email_change', {
    description: "For your security, confirm it's you before changing your college email.",
  });
  const { ensure, invalidate, current } = reauth;
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState(initialChallenge);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const cooldown = useResendCountdown(challenge?.resendAvailableAt);

  const send = useCallback(
    async (address) => {
      const normalized = String(address || '').trim().toLowerCase();
      if (!checkEmailFormat(normalized).valid) {
        setError('Enter your full college email address.');
        return;
      }
      setSending(true);
      setError(null);
      try {
        const res = await withReauth(
          { ensure, invalidate, current },
          (reauthToken) => sendCode({ collegeId: college.id, email: normalized, reauthToken }),
          { optional: true },
        );
        setChallenge({
          emailMasked: res?.emailMasked || normalized,
          expiresAt: res?.expiresAt || null,
          resendAvailableAt: res?.resendAvailableAt || null,
        });
        setCode('');
      } catch (err) {
        if (err?.code !== REAUTH_CANCELLED) setError(describeCampusOtpError(err));
      } finally {
        setSending(false);
      }
    },
    [college.id, sendCode, ensure, invalidate, current],
  );

  const verify = useCallback(
    async (value) => {
      if (verifying || !/^\d{6}$/.test(value)) return;
      setVerifying(true);
      setError(null);
      try {
        const affiliation = await withReauth(
          { ensure, invalidate, current },
          (reauthToken) => verifyCode(value, reauthToken),
          { optional: true },
        );
        invalidate();
        showToast('Welcome to campus!', 'success');
        onVerified?.(affiliation);
      } catch (err) {
        if (err?.code !== REAUTH_CANCELLED) setError(describeCampusOtpError(err));
        setCode('');
        setVerifying(false);
      }
    },
    [verifying, verifyCode, onVerified, ensure, invalidate, current],
  );

  const editEmail = () => {
    setChallenge(null);
    setCode('');
    setError(null);
  };

  const busy = sending || verifying;

  return (
    <div className={styles.card}>
      {reauth.modal}
      <div className={styles.selected}>
        <CollegeLogo name={college.name} logoUrl={college.logoUrl} large />
        <p className={styles.selectedName}>{college.name}</p>
        <button type="button" className={styles.linkBtn} onClick={onChangeCollege} disabled={busy}>
          Change
        </button>
      </div>

      {!challenge ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(email);
          }}
          noValidate
        >
          <h1 className={styles.title}>Confirm your college email</h1>
          <p className={styles.lead}>
            We&apos;ll send a 6-digit code to the email address your college gave you. It only unlocks
            Campus: you keep signing in with your current email.
          </p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="campus-college-email">
              College email
            </label>
            <input
              id="campus-college-email"
              className={styles.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@college.edu"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              disabled={busy}
            />
          </div>
          <div className={styles.error} role="alert" aria-live="polite">
            {error ? (
              <>
                <AlertCircle size={14} aria-hidden="true" />
                <span>{error}</span>
              </>
            ) : null}
          </div>
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
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify(code);
          }}
          noValidate
        >
          <h1 className={styles.title}>Enter the code</h1>
          <p className={styles.sentTo}>
            We sent a 6-digit code to <strong>{challenge.emailMasked || 'your college email'}</strong>.
          </p>
          <OtpCodeInput
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error) setError(null);
            }}
            onComplete={verify}
            disabled={verifying}
            invalid={Boolean(error)}
            autoFocus
            idPrefix="campus-otp"
          />
          <div className={styles.error} role="alert" aria-live="polite">
            {error ? (
              <>
                <AlertCircle size={14} aria-hidden="true" />
                <span>{error}</span>
              </>
            ) : null}
          </div>
          <div className={styles.meta}>
            {cooldown > 0 ? (
              <span>Resend in {cooldown}s</span>
            ) : email ? (
              <button type="button" className={styles.linkBtn} onClick={() => send(email)} disabled={busy}>
                {sending ? 'Sending…' : 'Send a new code'}
              </button>
            ) : (
              <button type="button" className={styles.linkBtn} onClick={editEmail} disabled={busy}>
                Send a new code
              </button>
            )}
            <button type="button" className={styles.linkBtn} onClick={editEmail} disabled={busy}>
              Use a different email
            </button>
          </div>
          <div className={styles.actions}>
            <button type="submit" className={styles.primaryBtn} disabled={busy || code.length !== 6}>
              {verifying ? (
                <>
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                  <span>Verifying…</span>
                </>
              ) : (
                <span>Verify</span>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
