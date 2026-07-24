import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { supabase } from '@shared/context/AuthContext';
import Background from '@shared/components/ui/Background';
import Toast from '@shared/components/ui/Toast';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react';
import styles from './ForgotPasswordPage.module.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const goBack = useSmartBack();

  const showToast = (msg) => {
    setToastMsg(msg);
    setToastVisible(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      showToast('Please enter a valid email address');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      
      if (error) throw error;
      
      setIsSubmitted(true);
    } catch (err) {
      const isExpectedError = err.status === 400 || err.status === 422 || err.message?.includes('not found') || err.message?.includes('invalid');
      if (isExpectedError) {
        showToast('If an account exists, you will receive a reset link shortly.');
        setIsSubmitted(true);
      } else {
        showToast(err.message || 'Something went wrong. Please check your connection and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Background />
      <div className={styles.flowContainer}>
        
        <div className={styles.progressContainer}>
          <button onClick={() => goBack('/login')} className={styles.backButton}>
            <span className={styles.iconCircle}>
              <ArrowLeft size={20} />
            </span>
            <span className={styles.backText}>Back</span>
          </button>
        </div>

        <div className={styles.contentArea}>
          <motion.div 
            className={styles.stepWrapper}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            {!isSubmitted ? (
              <>
                <h1 className={styles.headline}>Reset Password</h1>
                <p className={styles.subheadline}>Enter your email to receive a reset link.</p>
                <form onSubmit={handleSubmit} style={{ width: '100%', marginTop: '1.5rem' }}>
                  
                  <input
                    type="email"
                    autoFocus
                    className={styles.largeInput}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  
                  <button type="submit" className={styles.continueBtn} disabled={isSubmitting} style={{ marginTop: '1.5rem' }}>
                    {isSubmitting ? 'Sending...' : 'Send Reset Link'} <ArrowRight className={styles.btnIcon} />
                  </button>
                </form>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <div style={{ marginBottom: '1.5rem' }}>
                  <CheckCircle size={48} color="#10B981" />
                </div>
                <h1 className={styles.headline} style={{ textAlign: 'center' }}>Check your email</h1>
                <p className={styles.subheadline} style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                  We've sent a password reset link to <strong style={{ color: 'var(--color-text-main)' }}>{email}</strong>.
                </p>
                <p className={styles.subheadline} style={{ fontSize: '0.9rem', textAlign: 'center', marginBottom: '2.5rem' }}>
                  If an account exists, you will receive a reset link shortly.
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
