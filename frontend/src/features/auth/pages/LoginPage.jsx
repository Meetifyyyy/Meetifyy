import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react';
import loginIllustration from '@assets/login-illustration.png';
import s from './LoginPage.module.css';

export default function LoginPage() {
  const { login } = useAuth();

  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      await login(user.trim(), pass);
    } catch (err) {
      setError(err.message || 'Invalid username or password.');
      setLoading(false);
    }
  };

  return (
    <div className={s.loginContainer}>
      <div className={s.loginBox}>
        {/* Left Panel: UI Design Showcase */}
        <div className={s.leftPanel}>
          <div className={s.illustrationWrapper}>
            <img src={loginIllustration} alt="Login Illustration" className={s.loginIllustration} />
          </div>
        </div>

        {/* Right Panel: Credentials Form */}
        <div className={s.rightPanel}>

          <div className={s.formWrapper}>
            <div className={s.headerArea}>
              <div className={s.headerTextContent}>
                <h2 className={s.welcomeTitle}>Welcome back</h2>
                <p className={s.subtitle}>Let's pick up right where we left off.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* User box */}
              <div className={s.inputGroup}>
                <div className={s.inputWrapper}>
                  <input
                    id="user"
                    type="text"
                    autoFocus
                    autoComplete="username"
                    className={`${s.textInput} ${error && !user.trim() ? s.textInputError : ''}`}
                    placeholder=" "
                    value={user}
                    onChange={(e) => {
                      const val = e.target.value;
                      setUser(val.includes('@') ? val : val.toLowerCase());
                      if (error) setError(null);
                    }}
                  />
                  <label htmlFor="user" className={s.floatingLabel}>Username or Email</label>
                </div>
              </div>

              {/* Password box */}
              <div className={s.inputGroup}>
                <div className={s.inputWrapper}>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className={`${s.textInput} ${s.passwordInput} ${error && user.trim() && !pass ? s.textInputError : ''}`}
                    placeholder=" "
                    value={pass}
                    onChange={(e) => {
                      setPass(e.target.value);
                      if (error) setError(null);
                    }}
                  />
                  <label htmlFor="password" className={s.floatingLabel}>Password</label>
                  <button
                    type="button"
                    tabIndex={-1}
                    className={s.togglePassBtn}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Actions Row */}
              <div className={s.actionsRow}>
                <Link to="/forgot-password" className={s.forgotLink}>
                  Forgot password?
                </Link>
              </div>

              {error && (
                <div className={s.errorBox}>
                  <AlertCircle size={13} />
                  <span>{error}</span>
                </div>
              )}

              {/* Log In Button */}
              <button
                type="submit"
                className={s.submitButton}
                disabled={!user.trim() || !pass || loading}
              >
                {loading ? (
                  <>
                    <div className="spinner" style={{ width: '18px', height: '18px', borderColor: 'rgba(255, 255, 255, 0.3)', borderTopColor: 'white' }} />
                    Logging in...
                  </>
                ) : (
                  <>
                    Log in <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>

            {/* Create Account Option */}
            <div className={s.footerText}>
              Don't have an account? 
              <Link to="/signup" className={s.signupLink}>
                Create account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
