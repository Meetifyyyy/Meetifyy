import { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { supabase } from '@shared/context/AuthContext';
import Background from '@shared/components/ui/Background';
import Toast from '@shared/components/ui/Toast';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { getBackendUrl } from '@shared/api/apiClient';
import styles from './ForgotPasswordPage.module.css';

const apiUrl = getBackendUrl();

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasError, setHasError] = useState(false);
  
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showToast('This reset link is invalid or has expired. Please request a new one.');
        setTimeout(() => navigate('/forgot-password'), 2500);
      }
    };
    checkSession();
  }, []);

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
    setHasError(false);
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });
      
      if (error) throw error;
      
      setIsSubmitted(true);
      
      // Optionally trigger password changed email via backend
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const { data } = await supabase.auth.getUser();
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
        // Ignore backend error
      }
      
    } catch (err) {
      setHasError(true);
      showToast(err.message || 'Failed to update password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Background />
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
                <form onSubmit={handleSubmit} style={{ width: '100%', marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoFocus
                      className={styles.largeInput}
                      placeholder="New password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={{ paddingRight: '2.5rem' }}
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-light)'
                      }}
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                  
                  <div>
                    <input
                      type="password"
                      className={styles.largeInput}
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                  
                  <button type="submit" className={styles.continueBtn} disabled={isSubmitting} style={{ marginTop: '1rem' }}>
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
                  Your password has been successfully reset.
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
                  Return to log in
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
