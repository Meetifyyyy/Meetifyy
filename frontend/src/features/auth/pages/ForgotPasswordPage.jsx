import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import Toast from '@shared/components/ui/Toast';
import { MailCheck, ArrowRight } from '@shared/components/icons';
import {
  AuthShell,
  AuthHeading,
  AuthField,
  AuthButton,
  AuthStatus,
  BackButton,
  styles as s,
} from '../shared/ui';
import { apiClient } from '@shared/api/apiClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const goBack = useSmartBack();

  const showToast = (msg) => {
    setToastMsg(msg);
    setToastVisible(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      showToast('Enter a valid email');
      return;
    }

    setIsSubmitting(true);
    setNotFound(false);
    try {
      /*
       * One request where this screen used to make two.
       *
       * It asked `account-exists`, then fired `resetPasswordForEmail` at
       * Supabase straight from the browser. Only the first of those reached our
       * backend, so the half that actually SENDS MAIL passed through no limit
       * of ours — and the only ceiling left was Supabase's, which is per
       * project and therefore shared by everybody at once. One script pointed
       * at one address could exhaust it and stop every other user receiving a
       * reset link. `/api/auth/request-password-reset` does both halves behind
       * a per-address budget.
       *
       * It also closes a smaller gap: the redirect target is now built
       * server-side from configuration instead of being supplied by the
       * caller, and a client-chosen `redirectTo` on a reset link is an open
       * redirect carrying a recovery token in its fragment.
       *
       * Telling the user when there is no account is a deliberate product
       * decision — someone mistyping the address they signed up with was being
       * shown "check your email" and then waiting for a message that was never
       * going to arrive. What limits the exposure is that this route is
       * rate-limited exactly like the other unauthenticated lookups, so it is
       * not a usable bulk oracle.
       */
      const result = await apiClient.post('/api/auth/request-password-reset', {
        email: cleanEmail,
      });

      if (result && result.exists === false) {
        setNotFound(true);
        return;
      }

      // The account exists but the mail could not be dispatched — an upstream
      // or transport failure, not a wrong address. The sent screen still shows,
      // because the message may yet arrive and telling someone with a real
      // account that it does not exist is the one answer that must never come
      // out of a failure. The toast is what stops that screen being the only
      // thing they see, so "nothing arrived" reads as something to retry rather
      // than as a silent dead end.
      if (result && result.exists === true && result.sent === false) {
        showToast("We couldn't send the email just now. Try again shortly.");
      }

      setIsSubmitted(true);
    } catch (err) {
      if (err?.status === 429 || err?.message?.toLowerCase().includes('rate limit')) {
        // The server's message carries how long to wait; it is more useful than
        // our own wording.
        showToast(err?.message || 'Too many requests');
        return;
      }
      // A failure that is not a refusal is a transport problem rather than a
      // wrong address, and the request may well have gone through. Showing the
      // sent screen keeps the user from re-submitting into the same error.
      setIsSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <AuthShell
        headline={'Locked out?\n*We’ll get you back in.*'}
        subtext="Enter the email tied to your account and we'll send a secure reset link."
      >
        <div className={s.content}>
          {!isSubmitted ? (
            <>
              <BackButton onClick={() => goBack('/login')} />
              {/* The old subtitle hedged with "if an account exists", which was
                  the wording that went with never confirming either way. The
                  screen now says when there is no account, so the hedge only
                  reads as vagueness. */}
              <AuthHeading title="Reset your password" subtitle="Enter your email and we'll send you a secure reset link." />

              <form onSubmit={handleSubmit} className={s.form} noValidate>
                <AuthField
                  id="forgot-email"
                  label="Email Address"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    // Editing the address is the user answering the message, so
                    // it should not sit there contradicting what they now see.
                    if (notFound) setNotFound(false);
                  }}
                  error={notFound ? 'No account found. Check your email and try again.' : null}
                />

                <AuthButton
                  type="submit"
                  loading={isSubmitting}
                  loadingText="Sending..."
                  icon={<ArrowRight size={18} />}
                  disabled={!email.trim()}
                  style={{ marginTop: '0.2rem' }}
                >
                  Send Reset Link
                </AuthButton>
              </form>

              <div className={s.footer}>
                Remembered it?
                <Link to="/login" className={s.link}>
                  Back to login
                </Link>
              </div>
            </>
          ) : (
            <AuthStatus
              icon={MailCheck}
              tone="success"
              title="Check your email"
              description={
                <>
                  If an account exists for <strong>{email}</strong>, a reset link is on its way. Didn't get it?
                  Check your spam folder or try again in a few minutes.
                </>
              }
            >
              <Link to="/login" className={`${s.button} ${s.buttonGhost}`}>
                Return to log in
              </Link>
            </AuthStatus>
          )}
        </div>
      </AuthShell>
      <Toast message={toastMsg} visible={toastVisible} onHide={() => setToastVisible(false)} />
    </>
  );
}
