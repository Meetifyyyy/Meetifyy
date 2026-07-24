import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { ArrowRight, AlertCircle } from 'lucide-react';
import loginIllustration from '@assets/login-illustration.png';
import s from './LoginPage.module.css';

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
      // Just call login — PublicRoute will redirect to /home
      // automatically once isLoggedIn flips true via onAuthStateChange.
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

            <form onSubmit={handleSubmit}>
              {/* User box */}
              <div className={s.inputGroup}>
                <input
                  id="user"
                  type="text"
                  autoFocus
                  autoComplete="username"
                  className={`${s.textInput} ${error && !user.trim() ? s.textInputError : ''}`}
                  placeholder=" "
                  value={user}
                  onChange={(e) => {
                    // If it contains @ it's an email — allow uppercase, else force lowercase
                    const val = e.target.value;
                    setUser(val.includes('@') ? val : val.toLowerCase());
                    if (error) setError(null);
                  }}
                />
                <label htmlFor="user" className={s.floatingLabel}>Username or Email</label>
              </div>

              {/* Password box */}
              <div className={s.inputGroup}>
                <input
                  id="password"
                  type="password"
                  className={`${s.textInput} ${error && user.trim() && !pass ? s.textInputError : ''}`}
                  placeholder=" "
                  value={pass}
                  onChange={(e) => {
                    setPass(e.target.value);
                    if (error) setError(null);
                  }}
                />
                <label htmlFor="password" className={s.floatingLabel}>Password</label>
              </div>

              {/* Actions Row */}
              <div className={s.actionsRow}>
                {/* Forgot password button */}
                <Link to="/forgot-password" className={s.forgotLink}>
                  Forgot password?
                </Link>
              </div>

              <div style={{ minHeight: '1rem', marginBottom: '0.75rem' }}>
                {error && (
                  <div className={s.errorBox}>
                    <AlertCircle size={16} />
                    <span>{error}</span>
                  </div>
                )}
              </div>

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
