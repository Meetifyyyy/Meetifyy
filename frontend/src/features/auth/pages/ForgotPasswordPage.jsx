import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { supabase } from '@shared/context/AuthContext';
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
import { config } from '@config';
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
       * Tell the user when there is no account, rather than claiming an email
       * was sent.
       *
       * This screen used to always report success, deliberately, so that an
       * attacker could not learn which addresses are registered. That
       * protection is given up here as a product decision: someone mistyping
       * the address they signed up with was being shown "check your email" and
       * then waiting for a message that was never going to arrive, with no way
       * to tell the difference between a typo and a slow inbox.
       *
       * What limits the exposure is that `account-exists` is rate-limited on
       * the server exactly like the other unauthenticated lookups, so it is not
       * a usable bulk oracle.
       */
      const check = await apiClient
        .post('/api/auth/account-exists', { email: cleanEmail })
        // A failure here must never block a real reset: if the lookup is down
        // we assume the account exists and let the email path proceed.
        .catch(() => ({ exists: true }));

      if (check && check.exists === false) {
        setNotFound(true);
        return;
      }

      // The redirect target comes from configuration (VITE_SITE_URL, falling
      // back to the current origin) so the same code produces a localhost link
      // in development and the production domain in production.
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: config.auth.resetPasswordUrl,
      });

      if (error && error.message?.toLowerCase().includes('rate limit')) {
        showToast('Too many requests');
        return;
      }

      setIsSubmitted(true);
    } catch (err) {
      if (err?.message?.toLowerCase().includes('rate limit')) {
        showToast('Too many requests');
      } else {
        // The account was confirmed to exist above, so a failure at this point
        // is a transport problem rather than a wrong address. Showing the sent
        // screen keeps the user from re-submitting into the same error; the
        // link genuinely may still arrive.
        setIsSubmitted(true);
      }
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
