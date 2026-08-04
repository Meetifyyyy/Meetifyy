import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@shared/context/AuthContext';
import Toast from '@shared/components/ui/Toast';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { getBackendUrl } from '@shared/api/apiClient';
import styles from './ForgotPasswordPage.module.css';

const API_URL = getBackendUrl();
const MAX_PASSWORD_LENGTH = 128;

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState('');

  const recoverySessionRef = useRef(null);
  const navigate = useNavigate();

  const showToast = (msg) => {
    setToastMsg(msg);
    setToastVisible(true);
  };

  useEffect(() => {
    // ─── CRITICAL FIX ────────────────────────────────────────────────────
    // Do NOT call getSession() immediately on mount. Supabase processes the
    // #access_token fragment asynchronously — getSession() returns null if
    // called before that processing completes, incorrectly treating a valid
    // link as expired and redirecting the user away.
    //
    // Instead, listen for the PASSWORD_RECOVERY auth event which fires only
    // when Supabase has validated and consumed the reset token from the URL.
    // ─────────────────────────────────────────────────────────────────────

    let timeoutId;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          // Token is valid — Supabase has verified it and set a recovery session.
          recoverySessionRef.current = session;
          setHasValidSession(true);
          setIsCheckingSession(false);
          clearTimeout(timeoutId);
        }
      }
    );

    // Safety timeout — if PASSWORD_RECOVERY hasn't fired within 4 seconds, the
    // link is genuinely invalid or the hash fragment is missing/malformed.
    timeoutId = setTimeout(() => {
      if (!recoverySessionRef.current) {
        setSessionError('This reset link is invalid or has expired.');
        setIsCheckingSession(false);
      }
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  // Redirect away once the session-error grace period has elapsed
  useEffect(() => {
    if (!isCheckingSession && sessionError) {
      showToast(sessionError + ' Request a new one.');
      const t = setTimeout(() => navigate('/forgot-password'), 2500);
      return () => clearTimeout(t);
    }
  }, [isCheckingSession, sessionError, navigate]);

  // Auto-redirect to /login 3 seconds after a successful reset
  useEffect(() => {
    if (!isSubmitted) return;
    const t = setTimeout(() => navigate('/login', { replace: true }), 3000);
    return () => clearTimeout(t);
  }, [isSubmitted, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const trimmedPassword = password.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedPassword) {
      showToast('Please enter a new password.');
      return;
    }
    if (trimmedPassword.length < 8) {
      showToast('Password must be at least 8 characters.');
      return;
    }
    if (trimmedPassword.length > MAX_PASSWORD_LENGTH) {
      showToast(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (trimmedPassword !== trimmedConfirm) {
      showToast('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: updateData, error } = await supabase.auth.updateUser({
        password: trimmedPassword,
      });

      if (error) throw error;

      // Mark success BEFORE clearing isSubmitting so the button never
      // flickers back to interactive between these two state updates.
      setIsSubmitted(true);

      // Fire password-changed security notification email using data returned
      // directly from updateUser — no extra getSession/getUser round-trips.
      const updatedUser = updateData?.user;
      if (updatedUser?.email) {
        try {
          const session = recoverySessionRef.current;
          const token = session?.access_token;
          if (token) {
            fetch(`${API_URL}/api/auth/events/password-changed`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                email: updatedUser.email,
                name: updatedUser.user_metadata?.displayName || 'User',
                device: navigator.userAgent,
              }),
            }).catch(() => {/* fire-and-forget — password was already changed */});
          }
        } catch {
          // Non-fatal — password was still changed.
        }
      }

      // Sign out the temporary recovery session so it cannot be reused to
      // access the app. Done after setIsSubmitted so UX is unaffected.
      try {
        await supabase.auth.signOut();
      } catch {
        // Non-fatal — recovery session will expire naturally.
      }

    } catch (err) {
      showToast(err.message || 'Failed to update password. The link may have expired.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className={styles.flowContainer}>
        <div className={styles.contentArea}>
          <div className={styles.stepWrapper} style={{ alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <div style={{ width: 24, height: 24, border: '2px solid #CBD5E1', borderTopColor: '#3B82F6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Verifying reset link…</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.flowContainer}>
        <div className={styles.progressContainer} />

        <div className={styles.contentArea}>
          <motion.div
            className={styles.stepWrapper}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            {!isSubmitted ? (
              <>
                <h1 className={styles.headline}>Set New Password</h1>
                <p className={styles.subheadline}>Choose a strong, secure password.</p>
                <form onSubmit={handleSubmit} style={{ width: '100%', marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

                  {/* New password */}
                  <div className={styles.inputGroup}>
                    <div className={styles.inputWrapper}>
                      <input
                        id="new-password"
                        type={showPassword ? 'text' : 'password'}
                        autoFocus
                        autoComplete="new-password"
                        className={styles.largeInput}
                        placeholder=" "
                        value={password}
                        maxLength={MAX_PASSWORD_LENGTH}
                        onChange={(e) => setPassword(e.target.value)}
                        style={{ paddingRight: '2.75rem' }}
                      />
                      <label htmlFor="new-password" className={styles.floatingLabel}>New Password</label>
                      <button
                        type="button"
                        tabIndex={-1}
                        className={styles.togglePassBtn}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowPassword((p) => !p)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm password */}
                  <div className={styles.inputGroup}>
                    <div className={styles.inputWrapper}>
                      <input
                        id="confirm-new-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className={styles.largeInput}
                        placeholder=" "
                        value={confirmPassword}
                        maxLength={MAX_PASSWORD_LENGTH}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        style={{ paddingRight: '2.75rem' }}
                      />
                      <label htmlFor="confirm-new-password" className={styles.floatingLabel}>Confirm New Password</label>
                      <button
                        type="button"
                        tabIndex={-1}
                        className={styles.togglePassBtn}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowConfirmPassword((p) => !p)}
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className={styles.continueBtn}
                    disabled={isSubmitting || !hasValidSession}
                    style={{ marginTop: '1.25rem' }}
                  >
                    {isSubmitting ? 'Updating…' : 'Update Password'} <ArrowRight className={styles.btnIcon} />
                  </button>

                  {!hasValidSession && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: '0.5rem' }}>
                      This link is invalid or has expired.{' '}
                      <Link to="/forgot-password" style={{ color: 'var(--color-primary)' }}>Request a new one</Link>
                    </p>
                  )}
                </form>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <div style={{ marginBottom: '1.5rem' }}>
                  <CheckCircle size={48} color="#10B981" />
                </div>
                <h1 className={styles.headline} style={{ textAlign: 'center' }}>Password Updated</h1>
                <p className={styles.subheadline} style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
                  Your password has been reset. Redirecting to login…
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'center', marginBottom: '2.5rem' }}>
                  If all your other sessions were active, they've been signed out for security.
                </p>
                <Link
                  to="/login"
                  className={styles.continueBtn}
                  style={{
                    textDecoration: 'none',
                    background: 'var(--color-bg-white)',
                    color: 'var(--color-text-main)',
                    border: '1px solid var(--color-border)',
                    justifyContent: 'center',
                  }}
                >
                  Log in now
                </Link>
              </div>
            )}
          </motion.div>
        </div>
      </div>
      <Toast message={toastMsg} visible={toastVisible} onHide={() => setToastVisible(false)} />
    </>
  );
}
