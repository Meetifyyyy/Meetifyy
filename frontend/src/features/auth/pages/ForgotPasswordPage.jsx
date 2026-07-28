import { useState } from 'react';
import { Link } from 'react-router-dom';
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
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      showToast('Please enter a valid email address');
      return;
    }
    
    setIsSubmitting(true);
    try {
      // Send the reset email directly via Supabase.
      //
      // Security note: We intentionally do NOT check whether the account exists
      // first. This prevents user enumeration — an attacker cannot probe whether
      // an email is registered by observing different responses.
      //
      // The backend's syncProfile gate ensures that even if a reset link is
      // clicked for a non-verified/non-existent account, no Prisma user row
      // is ever created. The password reset link will simply fail silently on
      // the Supabase side if the account doesn't exist.
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      
      // Always show "check your email" — even if error, to prevent enumeration.
      // Supabase may return an error for rate limiting, which is the only case
      // where surfacing feedback makes sense.
      if (error && error.message?.toLowerCase().includes('rate limit')) {
        showToast('Too many requests. Please wait a moment before trying again.');
        return;
      }
      
      setIsSubmitted(true);
    } catch (err) {
      // Only surface rate limit errors — all other errors are swallowed
      if (err?.message?.toLowerCase().includes('rate limit')) {
        showToast('Too many requests. Please try again later.');
      } else {
        // Still show success UI to prevent enumeration
        setIsSubmitted(true);
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
                <p className={styles.subheadline}>Enter your email and we'll send a reset link if an account exists.</p>
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
                  If an account exists for <strong style={{ color: 'var(--color-text-main)' }}>{email}</strong>, a reset link is on its way.
                </p>
                <p className={styles.subheadline} style={{ fontSize: '0.9rem', textAlign: 'center', marginBottom: '2.5rem' }}>
                  Didn't get it? Check your spam folder or try again in a few minutes.
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
