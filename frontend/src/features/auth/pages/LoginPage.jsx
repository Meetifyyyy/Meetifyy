import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { ArrowRight, AlertCircle } from 'lucide-react';
import {
  AuthShell,
  AuthHeading,
  AuthField,
  PasswordField,
  AuthButton,
  styles as s,
} from '../shared/ui';

export default function LoginPage() {
  const { login } = useAuth();

  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedUser = user.trim();
    if (!trimmedUser) {
      setError('Please enter your username or email.');
      return;
    }
    if (!pass) {
      setError('Please enter your password.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await login(trimmedUser, pass);
      // On success the auth state change navigates away; keep the spinner up.
    } catch (err) {
      setError(err.message || 'Invalid username or password.');
      setLoading(false);
    }
  };

  return (
    <AuthShell
      headline={'Good to see\n*you again.*'}
      subtext="Your circles, your chats, your campus — right where you left them."
    >
      <div className={s.content}>
        <AuthHeading title="Welcome back" subtitle="Let's pick up right where we left off." />

        <form onSubmit={handleSubmit} className={s.form} noValidate>
          <AuthField
            id="login-user"
            label="Username or Email"
            type="text"
            autoFocus
            autoComplete="username"
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
            autoComplete="current-password"
            value={pass}
            error={error && user.trim() && !pass ? error : null}
            onChange={(e) => {
              setPass(e.target.value);
              if (error) setError(null);
            }}
          />

          <div className={s.actionsRow}>
            <Link to="/forgot-password" className={s.link}>
              Forgot password?
            </Link>
          </div>

          {error && user.trim() && pass ? (
            <div className={`${s.banner} ${s.bannerError}`}>
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          ) : null}

          <AuthButton
            type="submit"
            loading={loading}
            loadingText="Logging in..."
            icon={<ArrowRight size={18} />}
            disabled={!user.trim() || !pass}
            style={{ marginTop: '0.35rem' }}
          >
            Log in
          </AuthButton>
        </form>

        <div className={s.footer}>
          Don't have an account?
          <Link to="/signup" className={s.link}>
            Create account
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
