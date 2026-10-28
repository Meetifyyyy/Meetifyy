import { useCallback, useState } from 'react';
import { REAUTH_CANCELLED, useReauth } from '@shared/components/AccountEmail/ReauthModal';
import { withReauth } from '@shared/components/AccountEmail/withReauth';
import { AlertCircle, ChevronLeft, Loader2 } from '@shared/components/icons';
import OtpCodeInput, { useResendCountdown } from '@shared/components/OtpCodeInput';
import { useCampusAffiliationActions } from '@shared/hooks/useCampusAffiliationActions';
import { describeCampusOtpError } from '@shared/lib/campusAccess';
import { checkEmailFormat } from '@shared/utils/emailValidation';
import { showToast } from '@shared/utils/toast';
import CollegeLogo from './CollegeLogo';
import { emailPlaceholder, primaryDomain } from './collegeEmail';
import styles from './CampusAffiliation.module.css';

/**
 * Step two of joining Campus: prove the college email.
 *
 * `initialChallenge` is a code already sent (restored from the server's
 * `pending` after a reload). Its full address is not known here, only the
 * masked one, so a resend from that state asks for the address again.
 *
 * The screen reads top to bottom: back, the college's logo and name, why it is
 * asked, the email field and its action. `onBack` returns to the colleges.
 *
 * `screen` is the phone's full-screen layer: the back button and the form are
 * then two siblings of the layer itself (a fragment), not one card, so that the
 * form block is the layer's direct child. That is the element the app-wide
 * keyboard slide moves (useKeyboardInset / keyboardSheetRise: the child of the
 * fixed layer that holds the focused field), so it glides up with the keyboard
 * while the back button stays where it is.
 *
 * An account's first college email needs only the code. Any later one (a
 * change, or adding one back after removing it) also needs "confirm it's
 * you": the server answers `reauth_required` and the dialog opens, then the
 * same request is retried. The server also enforces the 30-day cooldown.
 */
export default function CollegeEmailVerify({ college, initialChallenge = null, onBack, onVerified, screen = false }) {
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

  const top = (
    <div className={styles.verifyTop}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={onBack}
        disabled={busy}
        aria-label="Back to colleges"
      >
        <ChevronLeft size={24} aria-hidden="true" />
      </button>
    </div>
  );

  const body = (
      <div className={screen ? `${styles.verifyBody} ${styles.verify}` : styles.verifyBody}>
        <div className={styles.verifyHero}>
          <CollegeLogo name={college.name} logoUrl={college.logoUrl} className={styles.heroLogo} />
          <h1 className={styles.verifyName}>{college.name}</h1>
        </div>

      {!challenge ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(email);
          }}
          noValidate
        >
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
              placeholder={emailPlaceholder(college)}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              disabled={busy}
            />
            {primaryDomain(college) ? (
              <span className={styles.fieldHint}>Use your @{primaryDomain(college)} address.</span>
            ) : null}
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
            <button type="submit" className={styles.primaryBtn} disabled={busy || !email.trim()} data-keyboard-reveal>
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
          <h2 className={styles.verifyTitle}>Enter the code</h2>
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
            <button type="submit" className={styles.primaryBtn} disabled={busy || code.length !== 6} data-keyboard-reveal>
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

  if (screen) {
    return (
      <>
        {reauth.modal}
        {top}
        {body}
      </>
    );
  }

  return (
    <div className={`${styles.card} ${styles.verify}`}>
      {reauth.modal}
      {top}
      {body}
    </div>
  );
}
