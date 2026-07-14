import React, { useState, useMemo } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Mail, ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step4Email() {
  const { signupData, updateData, nextStep } = useSignup();
  const [email, setEmail] = useState(signupData.email || '');
  const [otp, setOtp] = useState('');
  const [status, setStatus] = useState('input'); // input -> loading -> otp -> success

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  const emailError = useMemo(() => {
    if (!email) return null;
    if (!email.includes('@') && email.length > 2) return "Enter a valid email address.";
    if (!emailRegex.test(email) && email.includes('@')) return "Please provide a valid domain (e.g., .edu).";
    return null;
  }, [email]);

  const isValidEmail = emailRegex.test(email);

  const handleSendOtp = (e) => {
    e.preventDefault();
    if (isValidEmail) {
      setStatus('loading');
      setTimeout(() => {
        setStatus('otp');
      }, 2000);
    }
  };

  const handleVerify = (e) => {
    e.preventDefault();
    if (otp.length >= 4) {
      setStatus('success');
      updateData({ email });
      setTimeout(() => {
        nextStep();
      }, 1500);
    }
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <AnimatePresence mode="wait">
        
        {status === 'input' && (
          <motion.div key="input" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', color: '#8b5cf6' }}>
              <Mail size={24} />
              <span style={{ fontWeight: 600 }}>Let's verify your campus identity.</span>
            </div>
            <h2 className={styles.headline}>What's your college email?</h2>
            <form onSubmit={handleSendOtp}>
              <input 
                type="email" 
                autoFocus 
                className={`${styles.largeInput} ${emailError ? styles.inputError : ''}`} 
                placeholder="name@college.edu" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
              />
              
              <div style={{ minHeight: '2rem', marginTop: '0.5rem' }}>
                {emailError ? (
                  <div className={styles.errorText}><AlertCircle size={16} /> {emailError}</div>
                ) : null}
              </div>

              <button type="submit" className={styles.continueBtn} disabled={!isValidEmail}>
                Send OTP <ArrowRight className={styles.btnIcon} />
              </button>
            </form>
          </motion.div>
        )}

        {status === 'loading' && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ width: '100%', textAlign: 'center', padding: '3rem 0' }}>
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ display: 'inline-block', color: '#6366f1' }}>
              <Loader2 size={48} />
            </motion.div>
            <h2 style={{ marginTop: '1.5rem', fontSize: '1.25rem' }}>Checking if your university knows you...</h2>
          </motion.div>
        )}

        {status === 'otp' && (
          <motion.div key="otp" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} style={{ width: '100%' }}>
            <h2 className={styles.headline}>Enter Verification Code</h2>
            <p className={styles.subheadline}>We sent a code to <strong>{email}</strong></p>
            <form onSubmit={handleVerify}>
              <input 
                type="text" 
                autoFocus 
                className={styles.largeInput} 
                style={{ letterSpacing: '0.5em', textAlign: 'center', fontSize: '2.5rem' }} 
                placeholder="0000" 
                maxLength={4} 
                value={otp} 
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} 
              />
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                <button type="submit" className={styles.continueBtn} disabled={otp.length < 4}>
                  Verify <ArrowRight className={styles.btnIcon} />
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {status === 'success' && (
          <motion.div key="success" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} style={{ width: '100%', textAlign: 'center', padding: '3rem 0' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '80px', height: '80px', borderRadius: '50%', background: '#dcfce7', color: '#16a34a', marginBottom: '1.5rem' }}>
              <ShieldCheck size={40} />
            </div>
            <h2 className={styles.headline}>Verified Student ✅</h2>
          </motion.div>
        )}

      </AnimatePresence>
    </AnimatedStep>
  );
}
