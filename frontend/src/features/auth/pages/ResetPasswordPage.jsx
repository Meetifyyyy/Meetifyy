import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@shared/context/AuthContext';
import Toast from '@shared/components/ui/Toast';
import { CheckCircle2, XCircle } from '@shared/components/icons';
import { getBackendUrl } from '@shared/api/apiClient';
import {
  AuthShell,
  AuthHeading,
  PasswordField,
  AuthButton,
  AuthStatus,
  styles as s,
} from '../shared/ui';

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

// Set in supabase.js when the recovery link came back with an error hash
// (expired / invalid / already used). Lets us skip the validation wait entirely.
const RECOVERY_ERROR_FLAG = 'sb-pwreset-error';
const readRecoveryErrorFlag = () => {
  try { return sessionStorage.getItem(RECOVERY_ERROR_FLAG) === '1'; } catch { return false; }
};
const consumeRecoveryErrorFlag = () => {
  try { sessionStorage.removeItem(RECOVERY_ERROR_FLAG); } catch {}
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

    // ── Fast path: link arrived with an error hash ────────────────────────
    // supabase.js captured an expired/invalid/used recovery link before the
    // hash was cleared. Show the expired state immediately rather than waiting
    // out the 5-second validation timeout.
    if (readRecoveryErrorFlag()) {
      consumeRecoveryErrorFlag();
      markExpired();
      return () => {
        isMounted = false;
        clearTimeout(timeoutId);
      };
    }

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

    /*
     * The password is used exactly as entered. It is NOT trimmed.
     *
     * This used to store `password.trim()` while the login form sends what the
     * user typed untouched, so the two disagreed the moment a password had
     * leading or trailing whitespace — which a password manager, a paste, or a
     * mobile keyboard that appends a space after autocorrect will all produce.
     * The reset reported success and the new password then failed at login,
     * which is the worst possible failure for this screen: the account is
     * locked with a password the user just watched being accepted.
     *
     * Trimming also made the confirmation field lie. "secret " and "secret"
     * compared equal, so the user confirmed a password they had not typed.
     *
     * Whitespace is a legitimate password character. The only correct move is
     * to leave it alone at every point in the round trip.
     */
    if (!password) {
      showToast('Enter a new password');
      return;
    }
    if (password.length < 8) {
      showToast('Password too short (min 8)');
      return;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      showToast(`Password too long (max ${MAX_PASSWORD_LENGTH})`);
      return;
    }
    if (password !== confirmPassword) {
      showToast("Passwords don't match");
      return;
    }

    isSubmittingRef.current = true;
    setUiState('updating');

    try {
      const { data: updateData, error } = await supabase.auth.updateUser({
        password,
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
      showToast(err?.message || "Couldn't update password");
    }
    // isSubmittingRef is intentionally NOT reset on success — there should be
    // no way to re-submit after a password has been changed.
  };

  const isUpdating = uiState === 'updating';

  return (
    <>
      <AuthShell
        headline={'Almost there.\n*Set a fresh password.*'}
        subtext="Choose something strong you'll remember — your campus circle is waiting."
      >
        <div className={s.content}>
          {uiState === 'loading' && (
            <AuthStatus tone="loading" title="Verifying reset link…" description="This only takes a second." />
          )}

          {uiState === 'expired' && (
            <AuthStatus
              icon={XCircle}
              tone="error"
              title="Reset link expired"
              description="This password reset link is invalid or has expired. Please request a new one."
            >
              <Link to="/forgot-password" className={s.button}>
                Request new link
              </Link>
              <Link to="/login" className={`${s.button} ${s.buttonGhost}`}>
                Back to login
              </Link>
            </AuthStatus>
          )}

          {uiState === 'success' && (
            <AuthStatus
              icon={CheckCircle2}
              tone="success"
              title="Password updated"
              description="Your password has been reset successfully. Redirecting to login in a moment…"
            >
              <Link to="/login" replace className={`${s.button} ${s.buttonGhost}`}>
                Log in now
              </Link>
            </AuthStatus>
          )}

          {(uiState === 'valid' || uiState === 'updating') && (
            <>
              <AuthHeading title="Set new password" subtitle="Choose a strong, secure password." />

              <form onSubmit={handleSubmit} className={s.form} noValidate>
                <PasswordField
                  id="reset-new-password"
                  label="New Password"
                  autoComplete="new-password"
                  maxLength={MAX_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isUpdating}
                />

                <PasswordField
                  id="reset-confirm-password"
                  label="Confirm New Password"
                  autoComplete="new-password"
                  maxLength={MAX_PASSWORD_LENGTH}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isUpdating}
                />

                <AuthButton
                  type="submit"
                  loading={isUpdating}
                  loadingText="Updating..."
                  disabled={!password || !confirmPassword}
                  style={{ marginTop: '0.2rem' }}
                >
                  Update Password
                </AuthButton>
              </form>
            </>
          )}
        </div>
      </AuthShell>
      <Toast message={toastMsg} visible={toastVisible} onHide={() => setToastVisible(false)} />
    </>
  );
}
