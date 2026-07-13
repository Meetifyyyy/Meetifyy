import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSmartBack } from '../hooks/useSmartBack';
import Background from '../components/common/Background';
import Toast from '../components/common/Toast';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react';
import styles from './signup/SignupFlow.module.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const goBack = useSmartBack();

  const showToast = (msg) => {
    setToastMsg(msg);
    setToastVisible(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      showToast('Please enter a valid email address');
      return;
    }
    
    // Mock successful submission
    setIsSubmitted(true);
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
                  
                  <button type="submit" className={styles.continueBtn} style={{ marginTop: '1.5rem' }}>
                    Send Reset Link <ArrowRight className={styles.btnIcon} />
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
                  (This is a mock response. No actual email was sent.)
                </p>
                <Link to="/login" style={{ textDecoration: 'none', width: '100%', display: 'block' }}>
                  <button className={styles.continueBtn} style={{ background: 'var(--color-bg-white)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', justifyContent: 'center' }}>
                    Return to log in
                  </button>
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
