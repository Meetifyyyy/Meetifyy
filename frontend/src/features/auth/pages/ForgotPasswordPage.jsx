import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { supabase } from '@shared/context/AuthContext';
import Toast from '@shared/components/ui/Toast';
import { MailCheck, ArrowRight } from 'lucide-react';
import {
  AuthShell,
  AuthHeading,
  AuthField,
  AuthButton,
  AuthStatus,
  BackButton,
  styles as s,
} from '../shared/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    try {
      // Send the reset email directly via Supabase.
      //
      // Security note: We intentionally do NOT check whether the account exists
      // first. This prevents user enumeration — an attacker cannot probe whether
      // an email is registered by observing different responses.
      //
      // The backend's syncProfile gate ensures that even if a reset link is
      // clicked for a non-verified/non-existent account, no Prisma user row
      // is ever created. The password reset link will simply fail silently on
      // the Supabase side if the account doesn't exist.
      const siteUrl = import.meta.env.VITE_SITE_URL || (
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? 'https://dev.meetifyy.app'
          : window.location.origin
      );
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${siteUrl}/reset-password`,
      });

      // Always show "check your email" — even if error, to prevent enumeration.
      // Supabase may return an error for rate limiting, which is the only case
      // where surfacing feedback makes sense.
      if (error && error.message?.toLowerCase().includes('rate limit')) {
        showToast('Too many requests');
        return;
      }

      setIsSubmitted(true);
    } catch (err) {
      // Only surface rate limit errors — all other errors are swallowed
      if (err?.message?.toLowerCase().includes('rate limit')) {
        showToast('Too many requests');
      } else {
        // Still show success UI to prevent enumeration
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
              <AuthHeading title="Reset your password" subtitle="Enter your email and we'll send a reset link if an account exists." />

              <form onSubmit={handleSubmit} className={s.form} noValidate>
                <AuthField
                  id="forgot-email"
                  label="Email Address"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
