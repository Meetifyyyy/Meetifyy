import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Shield, ArrowRight, AlertCircle, Loader2, Eye, EyeOff } from '../components/icons';
import './login.css';

export const LoginPage: React.FC = () => {
  const { login, verifyOtp, verifyTotp } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<'PASSWORD' | 'OTP' | 'TOTP'>('PASSWORD');
  const [pendingToken, setPendingToken] = useState<string>('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await login(email, password);
      if (res && res.step === 'OTP_REQUIRED') {
        setPendingToken(res.pendingToken);
        setStep('OTP');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid admin credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await verifyOtp(pendingToken, otp);
      if (res && res.step === 'TOTP_REQUIRED') {
        setPendingToken(res.pendingToken);
        setStep('TOTP');
      } else if (res && res.success) {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await verifyTotp(pendingToken, totpCode);
      if (res && res.success) {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid TOTP code');
    } finally {
      setLoading(false);
    }
  };

  const isPassword = step === 'PASSWORD';
  const isEmailCode = step === 'OTP';
  const title = isPassword ? 'Welcome back.' : isEmailCode ? 'Check your inbox.' : 'One last step.';
  const description = isPassword
    ? 'Sign in to your Meetifyy workspace.'
    : isEmailCode
      ? `Enter the 6-digit verification code sent to ${email}.`
      : 'Enter the 6-digit code from your authenticator app.';

  return (
    <main className="admin-login-page">
      <div className="admin-login-shell">
        <aside className="admin-login-visual" aria-hidden="true">
          <div className="admin-login-art" aria-hidden="true">
            <div className="login-orb login-orb-striped" />
            <div className="login-orb login-orb-blue" />
            <div className="login-orb login-orb-glass" />
            <div className="login-flower">
              {Array.from({ length: 12 }, (_, index) => (
                <span key={index} style={{ '--petal-angle': `${index * 30}deg` } as React.CSSProperties} />
              ))}
              <div className="login-flower-center"><i /><i /></div>
            </div>
            <div className="login-orb login-orb-yellow" />
            <div className="login-orb login-orb-ring" />
            <div className="login-art-cube" />
          </div>
        </aside>

        <section className="admin-login-panel" aria-labelledby="admin-login-title">
          <div className="admin-login-form-content">
            <div className="admin-login-brand">
              <img src="/admin-avatar.jpg" alt="" width={36} height={36} />
              <span>Meetifyy <span>Admin</span></span>
            </div>
            <header className="admin-login-heading">
              <h1 id="admin-login-title">{title}</h1>
              <p>{description}</p>
            </header>

            {error && (
              <div className="admin-login-error" role="alert">
                <AlertCircle size={18} aria-hidden="true" /><span>{error}</span>
              </div>
            )}

            <form
              onSubmit={isPassword ? handlePasswordSubmit : isEmailCode ? handleOtpSubmit : handleTotpSubmit}
              className="admin-login-form"
              aria-busy={loading}
            >
              {isPassword ? (
                <>
                  <div className="admin-login-field">
                    <label htmlFor="admin-email">Email address</label>
                    <input id="admin-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} enterKeyHint="next" required
                      value={email} onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@meetifyy.com" disabled={loading} />
                  </div>
                  <div className="admin-login-field">
                    <label htmlFor="admin-password">Password</label>
                    <div className="admin-login-password">
                      <input id="admin-password" name="password" type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password" enterKeyHint="go" required value={password}
                        onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" disabled={loading} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="admin-login-field">
                  <label htmlFor="admin-verification-code">{isEmailCode ? 'Email verification code' : 'Authenticator code'}</label>
                  <input key={step} id="admin-verification-code" name="code" type="text" inputMode="numeric"
                    autoComplete="one-time-code" enterKeyHint="done" pattern="[0-9]{6}" minLength={6} maxLength={6} required
                    value={isEmailCode ? otp : totpCode}
                    onChange={(event) => (isEmailCode ? setOtp : setTotpCode)(event.target.value.replace(/\D/g, ''))}
                    placeholder="000000" className="admin-login-code" disabled={loading} />
                </div>
              )}
              <button type="submit" className="admin-login-submit"
                disabled={loading || (!isPassword && (isEmailCode ? otp : totpCode).length !== 6)}>
                {loading ? <><Loader2 size={18} className="spin" />{isPassword ? 'Signing in…' : 'Verifying…'}</>
                  : <>{isPassword ? 'Sign in' : isEmailCode ? 'Verify email' : 'Verify and sign in'}<ArrowRight size={18} /></>}
              </button>
            </form>
            <p className="admin-login-footer"><Shield size={15} aria-hidden="true" />Authorized administrators only</p>
          </div>
        </section>
      </div>
    </main>
  );
};
