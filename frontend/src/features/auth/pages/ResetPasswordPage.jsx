import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@shared/context/AuthContext';
import Background from '@shared/components/ui/Background';
import Toast from '@shared/components/ui/Toast';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { getBackendUrl } from '@shared/api/apiClient';
import styles from './ForgotPasswordPage.module.css';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  
  const navigate = useNavigate();

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          showToast('This reset link is invalid or has expired. Please request a new one.');
          setTimeout(() => navigate('/forgot-password'), 2500);
        } else {
          setHasValidSession(true);
        }
      } catch {
        showToast('Something went wrong. Please request a new reset link.');
        setTimeout(() => navigate('/forgot-password'), 2500);
      } finally {
        setIsCheckingSession(false);
      }
    };
    checkSession();
  }, [navigate]);

  const showToast = (msg) => {
    setToastMsg(msg);
    setToastVisible(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) {
      showToast('Please enter a new password');
      return;
    }
    if (password.length < 8) {
      showToast('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });
      
      if (error) throw error;
      
      // Optionally notify the user via email that their password changed
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const { data } = await supabase.auth.getUser();
        const apiUrl = getBackendUrl();
        if (data?.user?.email && token) {
          await fetch(`${apiUrl}/api/auth/events/password-changed`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ email: data.user.email, name: data.user.user_metadata?.displayName || 'User' })
          });
        }
      } catch (e) {
        // Ignore backend notification error — password was still changed
      }

      setIsSubmitted(true);

      // Sign out the reset session immediately after a successful password change.
      // This prevents the temporary reset session from being used to access the app
      // without going through a proper login with the new credentials.
      try {
        await supabase.auth.signOut();
      } catch (e) {
        // Ignore sign-out error
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
          <div className={styles.stepWrapper} style={{ alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>Verifying reset link…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.flowContainer}>
        
        <div className={styles.progressContainer}>
        </div>

        <div className={styles.contentArea}>
          <motion.div 
            className={styles.stepWrapper}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            {!isSubmitted ? (
              <>
                <h1 className={styles.headline}>Set New Password</h1>
                <p className={styles.subheadline}>Please choose a new, secure password.</p>
                <form onSubmit={handleSubmit} style={{ width: '100%', marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  
                  <div className={styles.inputGroup}>
                    <div className={styles.inputWrapper}>
                      <input
                        id="new-password"
                        type={showPassword ? 'text' : 'password'}
                        autoFocus
                        className={styles.largeInput}
                        placeholder=" "
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={{ paddingRight: '2.75rem' }}
                      />
                      <label htmlFor="new-password" className={styles.floatingLabel}>New Password</label>
                      <button
                        type="button"
                        tabIndex={-1}
                        className={styles.togglePassBtn}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  
                  <div className={styles.inputGroup}>
                    <div className={styles.inputWrapper}>
                      <input
                        id="confirm-new-password"
                        type="password"
                        className={styles.largeInput}
                        placeholder=" "
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                      <label htmlFor="confirm-new-password" className={styles.floatingLabel}>Confirm New Password</label>
                    </div>
                  </div>
                  
                  <button type="submit" className={styles.continueBtn} disabled={isSubmitting || !hasValidSession} style={{ marginTop: '1.25rem' }}>
                    {isSubmitting ? 'Updating...' : 'Update Password'} <ArrowRight className={styles.btnIcon} />
                  </button>
                </form>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <div style={{ marginBottom: '1.5rem' }}>
                  <CheckCircle size={48} color="#10B981" />
                </div>
                <h1 className={styles.headline} style={{ textAlign: 'center' }}>Password Updated!</h1>
                <p className={styles.subheadline} style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                  Your password has been reset. Log in with your new credentials.
                </p>
                <Link
                  to="/login"
                  className={styles.continueBtn}
                  style={{
                    textDecoration: 'none',
                    background: 'var(--color-bg-white)',
                    color: 'var(--color-text-main)',
                    border: '1px solid var(--color-border)',
                    justifyContent: 'center'
                  }}
                >
                  Log in
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
