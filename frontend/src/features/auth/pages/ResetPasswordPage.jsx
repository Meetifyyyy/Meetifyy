import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@shared/context/AuthContext';
import Toast from '@shared/components/ui/Toast';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle, Eye, EyeOff, XCircle } from 'lucide-react';
import { getBackendUrl } from '@shared/api/apiClient';
import styles from './ForgotPasswordPage.module.css';

const API_URL = getBackendUrl();
const MAX_PASSWORD_LENGTH = 128;

// ─── sessionStorage flag helpers ──────────────────────────────────────────────
// The flag 'sb-pwreset-pending' is written in supabase.js at module-eval time
// (before createClient clears the URL hash) when the URL contains type=recovery.
// It proves that THIS tab was opened from a genuine password recovery email link.
// We consume the flag — removing it from storage — once validation is resolved.
const RECOVERY_FLAG = 'sb-pwreset-pending';
const readRecoveryFlag = () => {
  try { return sessionStorage.getItem(RECOVERY_FLAG) === '1'; } catch { return false; }
};
const consumeRecoveryFlag = () => {
  try { sessionStorage.removeItem(RECOVERY_FLAG); } catch {}
};

// ─── UI State Machine ──────────────────────────────────────────────────────────
// loading   → token validation in progress (spinner; form never shown here)
// valid     → token confirmed; show New Password + Confirm Password form
// updating  → password update request in-flight; form locked, button disabled
// success   → password changed; success state shown, auto-redirect to /login
// expired   → token invalid / expired / already used; dedicated full-page state
// ──────────────────────────────────────────────────────────────────────────────

export default function ResetPasswordPage() {
  const [uiState, setUiState] = useState('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  // Holds the recovery session for use in the notification email request.
  const recoverySessionRef = useRef(null);

  // Guards against the validation resolving more than once. Multiple paths run
  // concurrently (getSession + onAuthStateChange) — only the first winner acts.
  const sessionConsumedRef = useRef(false);

  // Guards against concurrent form submissions in the narrow window between a
  // rapid second click and the `updating` UI state propagating to the button.
  const isSubmittingRef = useRef(false);

  const navigate = useNavigate();

  const showToast = (msg) => {
    setToastMsg(msg);
    setToastVisible(true);
  };

  // ─── Token Validation ────────────────────────────────────────────────────────
  useEffect(() => {
    // ──────────────────────────────────────────────────────────────────────────
    // WHY THREE PARALLEL PATHS:
    //
    // Supabase calls detectSessionFromUrl() inside createClient() which runs at
    // module-load time (supabase.js), BEFORE React renders anything. The
    // PASSWORD_RECOVERY event fires asynchronously once the token exchange with
    // the Supabase server completes.
    //
    // Because this page is lazy-loaded via Suspense, the component can mount:
    //   A) BEFORE the exchange completes → listener catches PASSWORD_RECOVERY ✓
    //   B) AFTER  the exchange completes → listener gets INITIAL_SESSION (not
    //      PASSWORD_RECOVERY again); getSession() returns the recovery session.
    //
    // Path 1 — onAuthStateChange → PASSWORD_RECOVERY
    //   Supabase fires this once when the recovery token is validated. It is the
    //   definitive confirmation that the session is a recovery session.
    //
    // Path 2 — onAuthStateChange → INITIAL_SESSION  (+ recovery flag check)
    //   Fired immediately when our listener attaches, replaying the current
    //   session. In case B above, this carries the recovery session. We only
    //   accept it when the sessionStorage flag confirms this tab came from a
    //   recovery link — preventing a logged-in user who manually navigates to
    //   /reset-password from seeing the form with their normal session.
    //
    // Path 3 — supabase.auth.getSession()  (+ recovery flag check)
    //   Belt-and-suspenders in case INITIAL_SESSION fires before our subscription
    //   is fully registered (e.g. very fast re-render cycles). Same flag guard.
    //
    // sessionConsumedRef ensures only the first path to resolve acts; the others
    // silently return. A 5-second safety timeout handles genuinely bad tokens.
    // ──────────────────────────────────────────────────────────────────────────

    let timeoutId;
    let isMounted = true;

    const markValid = (session) => {
      if (!isMounted || sessionConsumedRef.current) return;
      sessionConsumedRef.current = true;
      recoverySessionRef.current = session;
      consumeRecoveryFlag();
      clearTimeout(timeoutId);
      setUiState('valid');
    };

    const markExpired = () => {
      if (!isMounted || sessionConsumedRef.current) return;
      sessionConsumedRef.current = true;

      // ── Destroy any lingering recovery session ────────────────────────
      // consumeRecoveryFlag() removes the sessionStorage guard that keeps
      // AuthContext from calling setSession(). After it's gone, any live
      // recovery session in Supabase's localStorage will be picked up on
      // the next session check — making isLoggedIn = true and causing
      // PublicRoute pages (like /forgot-password) to redirect to /home.
      //
      // We only sign out when the flag was present (tab was opened from a
      // recovery email). A regular logged-in user who navigates here
      // manually (without a recovery link) is NOT signed out.
      const hadRecoveryFlag = readRecoveryFlag();
      consumeRecoveryFlag();
      if (hadRecoveryFlag) {
        supabase.auth.signOut().catch(() => {});
      }

      clearTimeout(timeoutId);
      setUiState('expired');
    };

    // ── Path 1 & 2: event listener ────────────────────────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;

        if (event === 'PASSWORD_RECOVERY') {
          // Supabase has validated the recovery token — this is definitively
          // a recovery session; no additional flag check needed.
          markValid(session);
          return;
        }

        if (event === 'INITIAL_SESSION') {
          // Our listener attached after PASSWORD_RECOVERY already fired.
          // Only accept the existing session when the recovery flag confirms
          // this tab was opened from a recovery email link. Without the flag,
          // a user who is already logged in and navigates to /reset-password
          // would otherwise see the password form with their normal session.
          if (session && readRecoveryFlag()) {
            markValid(session);
          }
          // No flag (or no session) → fall through; timeout handles it.
          return;
        }

        // Other events (e.g. TOKEN_REFRESHED during a long session on the page)
        // are intentionally ignored here.
      }
    );

    // ── Path 3: getSession() for belt-and-suspenders ──────────────────────
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted || sessionConsumedRef.current) return;
      // Only accept if the recovery flag is still set; same reason as Path 2.
      if (session && readRecoveryFlag()) {
        markValid(session);
      }
    }).catch(() => {
      // Network error — non-fatal; the listener + timeout will handle it.
    });

    // ── Safety timeout ────────────────────────────────────────────────────
    // If none of the paths above resolved within 5 seconds, the token is
    // genuinely invalid (expired, malformed, already used, missing, etc.).
    timeoutId = setTimeout(() => {
      if (!isMounted || sessionConsumedRef.current) return;
      markExpired();
    }, 5000);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  // ─── Auto-redirect after success ──────────────────────────────────────────
  useEffect(() => {
    if (uiState !== 'success') return;
    const t = setTimeout(() => navigate('/login', { replace: true }), 3000);
    return () => clearTimeout(t);
  }, [uiState, navigate]);

  // ─── Password update ───────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Ref-based guard prevents concurrent submissions from rapid double-clicks,
    // and also guards against calling this while not in the `valid` state
    // (e.g. if React has not yet propagated the `updating` state to the button).
    if (isSubmittingRef.current || uiState !== 'valid') return;

    const trimmedPassword = password.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedPassword) {
      showToast('Enter a new password.');
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

    isSubmittingRef.current = true;
    setUiState('updating');

    try {
      const { data: updateData, error } = await supabase.auth.updateUser({
        password: trimmedPassword,
      });

      if (error) throw error;

      // Transition to success immediately so the UI is responsive regardless
      // of how long the async cleanup steps take.
      setUiState('success');

      // ── Fire-and-forget: security notification email ──────────────────
      const updatedUser = updateData?.user;
      if (updatedUser?.email) {
        const token = recoverySessionRef.current?.access_token;
        if (token) {
          fetch(`${API_URL}/api/auth/events/password-changed`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              email: updatedUser.email,
              name: updatedUser.user_metadata?.displayName || 'User',
              device: navigator.userAgent,
            }),
          }).catch(() => {}); // non-fatal
        }
      }

      // ── Destroy the recovery session ──────────────────────────────────
      // This call:
      //   1. Invalidates the recovery token server-side immediately.
      //   2. Clears the session from localStorage so the same link cannot
      //      be clicked again and show the form.
      //   3. Fires SIGNED_OUT in AuthContext, which correctly clears any
      //      residual auth state (even though we kept it isolated earlier).
      // Fire-and-forget — the success state is already shown.
      supabase.auth.signOut().catch(() => {});

    } catch (err) {
      // Revert to the form so the user can try again (e.g. weak password,
      // JWT expired before submission, network failure).
      setUiState('valid');
      isSubmittingRef.current = false;
      showToast(err?.message || 'Failed to update password. Please try again.');
    }
    // isSubmittingRef is intentionally NOT reset on success — there should be
    // no way to re-submit after a password has been changed.
  };

  // ─── Loading ─────────────────────────────────────────────────────────────────
  if (uiState === 'loading') {
    return (
      <div className={styles.flowContainer}>
        <div className={styles.contentArea}>
          <div
            className={styles.stepWrapper}
            style={{ alignItems: 'center', justifyContent: 'center', gap: '0.75rem', minHeight: 160 }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                border: '2.5px solid #E2E8F0',
                borderTopColor: '#4F46E5',
                borderRadius: '50%',
                animation: 'spin 0.75s linear infinite',
              }}
            />
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', margin: 0 }}>
              Verifying reset link…
            </p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      </div>
    );
  }

  // ─── Expired / Invalid / Used ─────────────────────────────────────────────
  if (uiState === 'expired') {
    return (
      <div className={styles.flowContainer}>
        <div className={styles.contentArea}>
          <motion.div
            className={styles.stepWrapper}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ alignItems: 'center' }}
          >
            <div style={{ marginBottom: '1.25rem' }}>
              <XCircle size={48} color="#EF4444" strokeWidth={1.5} />
            </div>
            <h1
              className={styles.headline}
              style={{ textAlign: 'center', fontSize: '1.35rem', marginBottom: '0.5rem' }}
            >
              Reset Link Expired
            </h1>
            <p
              className={styles.subheadline}
              style={{ textAlign: 'center', marginBottom: '2rem', lineHeight: 1.6 }}
            >
              This password reset link is invalid or has expired.
              <br />
              Please request a new password reset email.
            </p>
            <Link
              to="/forgot-password"
              className={styles.continueBtn}
              style={{ textDecoration: 'none', justifyContent: 'center' }}
            >
              Request New Link <ArrowRight className={styles.btnIcon} />
            </Link>
            <Link
              to="/login"
              style={{
                marginTop: '0.875rem',
                fontSize: '0.85rem',
                color: 'var(--color-text-muted)',
                textDecoration: 'none',
                textAlign: 'center',
              }}
            >
              Back to Login
            </Link>
          </motion.div>
        </div>
      </div>
    );
  }

  // ─── Success ──────────────────────────────────────────────────────────────
  if (uiState === 'success') {
    return (
      <div className={styles.flowContainer}>
        <div className={styles.contentArea}>
          <motion.div
            className={styles.stepWrapper}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ alignItems: 'center' }}
          >
            <div style={{ marginBottom: '1.25rem' }}>
              <CheckCircle size={48} color="#10B981" strokeWidth={1.5} />
            </div>
            <h1
              className={styles.headline}
              style={{ textAlign: 'center', marginBottom: '0.5rem' }}
            >
              Password Updated
            </h1>
            <p
              className={styles.subheadline}
              style={{ textAlign: 'center', marginBottom: '0.5rem' }}
            >
              Your password has been reset successfully.
            </p>
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--color-text-muted)',
                textAlign: 'center',
                marginBottom: '2.5rem',
              }}
            >
              Redirecting to login in a moment…
            </p>
            <Link
              to="/login"
              replace
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
          </motion.div>
        </div>
      </div>
    );
  }

  // ─── Valid / Updating (form) ───────────────────────────────────────────────
  const isUpdating = uiState === 'updating';

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
            <h1 className={styles.headline}>Set New Password</h1>
            <p className={styles.subheadline}>Choose a strong, secure password.</p>

            <form
              onSubmit={handleSubmit}
              style={{
                width: '100%',
                marginTop: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
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
                    disabled={isUpdating}
                  />
                  <label htmlFor="new-password" className={styles.floatingLabel}>
                    New Password
                  </label>
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
                    disabled={isUpdating}
                  />
                  <label htmlFor="confirm-new-password" className={styles.floatingLabel}>
                    Confirm New Password
                  </label>
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
                disabled={isUpdating}
                style={{ marginTop: '1.25rem' }}
              >
                {isUpdating ? 'Updating…' : 'Update Password'}{' '}
                {!isUpdating && <ArrowRight className={styles.btnIcon} />}
              </button>
            </form>
          </motion.div>
        </div>
      </div>
      <Toast
        message={toastMsg}
        visible={toastVisible}
        onHide={() => setToastVisible(false)}
      />
    </>
  );
}
