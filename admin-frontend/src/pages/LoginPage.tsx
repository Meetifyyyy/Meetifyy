import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Shield, KeyRound, Mail, ArrowRight, AlertCircle, Loader2 } from '../components/icons';

export const LoginPage: React.FC = () => {
  const { login, verifyOtp, verifyTotp } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<'PASSWORD' | 'OTP' | 'TOTP'>('PASSWORD');
  const [pendingToken, setPendingToken] = useState<string>('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-main)',
        padding: '1.5rem',
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '400px',
          padding: '2.25rem 2rem',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '0.85rem',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
            }}
          >
            <Sparkles size={24} color="#fff" />
          </div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>Super Admin</h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-light)', marginTop: '0.2rem' }}>
            {step === 'PASSWORD' && 'Enter master credentials to continue'}
            {step === 'OTP' && 'Enter 6-digit email verification code'}
            {step === 'TOTP' && 'Enter Google Authenticator code'}
          </p>
        </div>

        {error && (
          <div
            style={{
              background: 'var(--color-danger-tint)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'var(--color-danger-hover)',
              padding: '0.65rem 0.85rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Email + Password */}
        {step === 'PASSWORD' && (
          <form onSubmit={handlePasswordSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                Admin Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} color="var(--color-text-dim)" style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="input-control"
                  style={{ paddingLeft: '2.4rem' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                Master Password
              </label>
              <div style={{ position: 'relative' }}>
                <Shield size={16} color="var(--color-text-dim)" style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="input-control"
                  style={{ paddingLeft: '2.4rem' }}
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '0.75rem' }}>
              {loading ? <Loader2 size={16} className="spin" /> : <>Sign In <ArrowRight size={16} /></>}
            </button>
          </form>
        )}

        {/* Step 2: Email OTP */}
        {step === 'OTP' && (
          <form onSubmit={handleOtpSubmit}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                Verification Code
              </label>
              <input
                type="text"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="input-control"
                style={{
                  fontSize: '1.25rem',
                  letterSpacing: '6px',
                  textAlign: 'center',
                  padding: '0.75rem',
                }}
              />
            </div>

            <button type="submit" disabled={loading || otp.length !== 6} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '0.75rem' }}>
              {loading ? <Loader2 size={16} className="spin" /> : 'Verify Code'}
            </button>
          </form>
        )}

        {/* Step 3: TOTP */}
        {step === 'TOTP' && (
          <form onSubmit={handleTotpSubmit}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                Authenticator Code
              </label>
              <div style={{ position: 'relative' }}>
                <KeyRound size={16} color="var(--color-text-dim)" style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  maxLength={6}
                  required
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="000000"
                  className="input-control"
                  style={{
                    paddingLeft: '2.4rem',
                    letterSpacing: '4px',
                    fontSize: '1.1rem',
                  }}
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '0.75rem' }}>
              {loading ? <Loader2 size={16} className="spin" /> : 'Authenticate'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
