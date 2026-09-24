import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { ArrowRight } from '@shared/components/icons';
import {
  AuthShell,
  AuthHeading,
  AuthField,
  PasswordField,
  AuthButton,
  AuthAlert,
  styles as s,
} from '../shared/ui';
import { AUTH_STORIES } from '../shared/ui/authStories';

/**
 * What the notice says. A request that never reached the server comes back
 * from the browser as "Failed to fetch" / "NetworkError…" / "Load failed",
 * which means nothing to a person; everything else is the server's own
 * message and is shown as it is.
 */
function friendlyLoginError(err) {
  const msg = err?.message || '';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return "We couldn't reach Meetifyy. Check your connection and try again.";
  }
  return msg || 'Invalid username or password.';
}

export default function LoginPage() {
  const { login } = useAuth();
  const goBack = useSmartBack();
  // Previous page, or the site root when login was the first page opened.
  const handleBack = useCallback(() => goBack('/'), [goBack]);

  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const passRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Bumped on every failed attempt, so the notice re-appears even when a
  // retry fails with the same message as the last one.
  const [errorNonce, setErrorNonce] = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedUser = user.trim();
    // Browser autofill may not fire onChange — read directly from the DOM as fallback.
    const effectivePass = pass || passRef.current?.value || '';
    if (!trimmedUser) {
      setError('Please enter your username or email.');
      return;
    }
    if (!effectivePass) {
      setError('Please enter your password.');
      return;
    }

    /*
     * The previous error is NOT cleared here. Clearing it collapsed the alert,
     * which slid the button up, and a failed retry reopened it and slid the
     * button back down: the flicker on every retry. It stays put while the
     * request runs and is replaced (or left behind by navigation) when it ends.
     */
    setLoading(true);
    try {
      await login(trimmedUser, effectivePass);
      // On success the auth state change navigates away; keep the spinner up.
    } catch (err) {
      setError(friendlyLoginError(err));
      setErrorNonce((n) => n + 1);
      setLoading(false);
    }
  };

  return (
    <AuthShell
      headline={AUTH_STORIES['/login'].headline}
      subtext={AUTH_STORIES['/login'].subtext}
      onBack={handleBack}
    >
      <div className={`${s.content} ${s.loginMain}`}>
        <AuthHeading title="Welcome back" subtitle="Let's pick up right where we left off." />

        <form onSubmit={handleSubmit} className={s.form} noValidate>
          <AuthField
            id="login-user"
            label="Username or Email"
            hideLabel
            type="text"
            autoComplete="off"
            value={user}
            error={error && !user.trim() ? error : null}
            onChange={(e) => {
              const val = e.target.value;
              setUser(val.includes('@') ? val : val.toLowerCase());
              if (error) setError(null);
            }}
          />

          <PasswordField
            id="login-password"
            label="Password"
            hideLabel
            autoComplete="new-password"
            ref={passRef}
            value={pass}
            error={error && user.trim() && !pass ? error : null}
            onChange={(e) => {
              setPass(e.target.value);
              if (error) setError(null);
            }}
            onInput={(e) => {
              // Sync browser autofill into React state (autofill fires input but not change)
              if (e.target.value && !pass) setPass(e.target.value);
            }}
          />

          <AuthAlert tone="error" title="Couldn't log in" autoHideMs={4000} nonce={errorNonce}>
            {error && user.trim() && pass ? error : null}
          </AuthAlert>

          <AuthButton
            type="submit"
            loading={loading}
            loadingText="Logging in..."
            icon={<ArrowRight size={18} />}
            disabled={!user.trim() || (!pass && !passRef.current?.value)}
          >
            Log in
          </AuthButton>

          <Link to="/forgot-password" className={s.textButton}>
            Forgot password?
          </Link>
        </form>
      </div>

      {/* Sign-up is its own destination, not a footnote: a real button, at
          the bottom of the screen on phones and the foot of the card on
          larger screens. */}
      <div className={s.loginFoot}>
        <span className={s.loginFootText}>Don&apos;t have an account?</span>
        <Link to="/signup" className={`${s.button} ${s.buttonGhost} ${s.loginFootButton}`}>
          Create account
        </Link>
      </div>
    </AuthShell>
  );
}
