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
          {/* Background Decorative Shapes (Max 6, exact shapes from reference grid) */}
          <div className={s.shapeContainer} aria-hidden="true">
            {/* Shape 1: Plump 4-Lobe Clover (Indigo) */}
            <svg className={`${s.bgShape} ${s.shape1}`} viewBox="0 0 100 100" fill="none">
              <path d="M 35 0 C 45 0 50 15 50 25 C 50 15 55 0 65 0 C 85 0 100 15 100 35 C 100 45 85 50 75 50 C 85 50 100 55 100 65 C 100 85 85 100 65 100 C 55 100 50 85 50 75 C 50 85 45 100 35 100 C 15 100 0 85 0 65 C 0 55 15 50 25 50 C 15 50 0 45 0 35 C 0 15 15 0 35 0 Z" fill="#6366F1" />
            </svg>

            {/* Shape 2: Smooth 8-Star Flower (Yellow) */}
            <svg className={`${s.bgShape} ${s.shape2}`} viewBox="0 0 100 100" fill="none">
              <path d="M 50 0 C 55 15 62 15 75 8 C 78 22 86 26 92 35 C 85 47 85 54 92 65 C 86 74 78 78 75 92 C 62 85 55 85 50 100 C 45 85 38 85 25 92 C 22 78 14 74 8 65 C 15 54 15 47 8 35 C 14 26 22 22 25 8 C 38 15 45 15 50 0 Z" fill="#F59E0B" />
            </svg>

            {/* Shape 3: 4-Circle Group (Pink) */}
            <svg className={`${s.bgShape} ${s.shape3}`} viewBox="0 0 100 100" fill="none">
              <circle cx="28" cy="28" r="26" fill="#EC4899" />
              <circle cx="72" cy="28" r="26" fill="#EC4899" />
              <circle cx="28" cy="72" r="26" fill="#EC4899" />
              <circle cx="72" cy="72" r="26" fill="#EC4899" />
            </svg>

            {/* Shape 4: Dome Arch (Orange) */}
            <svg className={`${s.bgShape} ${s.shape4}`} viewBox="0 0 100 100" fill="none">
              <path d="M 0 100 V 50 A 50 50 0 0 1 100 50 V 100 Z" fill="#FF6B00" />
            </svg>

            {/* Shape 5: Quarter Circle Arc (Red) */}
            <svg className={`${s.bgShape} ${s.shape5}`} viewBox="0 0 100 100" fill="none">
              <path d="M 0 100 V 0 A 100 100 0 0 1 100 100 H 0 Z" fill="#F43F5E" />
            </svg>

            {/* Shape 6: Scalloped Badge (Green) */}
            <svg className={`${s.bgShape} ${s.shape6}`} viewBox="0 0 100 100" fill="none">
              <path d="M 50 0 C 56 4 62 0 67 7 C 74 6 78 12 84 17 C 88 23 94 26 96 33 C 97 40 100 47 98 54 C 99 61 95 68 92 74 C 88 79 84 86 77 88 C 72 94 65 96 58 98 C 51 98 45 100 38 97 C 32 96 26 91 21 87 C 15 84 10 78 7 71 C 5 65 0 58 1 51 C 0 44 5 37 7 31 C 11 25 15 18 22 15 C 27 10 33 6 40 4 C 45 0 48 2 50 0 Z" fill="#10B981" />
            </svg>
          </div>

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
