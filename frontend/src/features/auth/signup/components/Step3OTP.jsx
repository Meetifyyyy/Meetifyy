import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion } from 'framer-motion';
import { ArrowRight, AlertCircle, Mail, Loader2, Check } from 'lucide-react';
import styles from '../SignupFlow.module.css';

export default function Step3OTP() {
  const { signupData, nextStep } = useSignup();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('input'); // input -> verifying -> success
  const [timer, setTimer] = useState(59);

  const inputsRef = useRef([]);

  useEffect(() => {
    let interval = null;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((t) => t - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timer]);

  const handleResend = () => {
    setTimer(59);
    setError(null);
  };

  const handleChange = (e, index) => {
    const val = e.target.value;
    if (isNaN(Number(val))) return; // allow only digits
    
    const newCode = [...code];
    newCode[index] = val.substring(val.length - 1); // take only the last digit
    setCode(newCode);

    if (val && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const isComplete = code.every((digit) => digit !== '');

  const handleVerify = (e) => {
    if (e) e.preventDefault();
    if (!isComplete) return;

    setStatus('verifying');
    setError(null);

    const enteredCode = code.join('');

    setTimeout(() => {
      // Allow '123456' as the mock OTP
      if (enteredCode === '123456') {
        setStatus('success');
        setTimeout(() => {
          nextStep();
        }, 1500);
      } else {
        setStatus('input');
        setError('Incorrect code. Try entering 123456.');
      }
    }, 1500);
  };

  useEffect(() => {
    if (isComplete) {
      handleVerify();
    }
  }, [code]);

  return (
    <AnimatedStep className={styles.stepWrapper}>


      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)', marginBottom: '1rem' }}>
        <Mail size={24} />
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Verify Email</span>
      </div>
      <h2 className={styles.headline}>Enter verification code</h2>
      <p className={styles.subheadline}>We sent a 6-digit code to <strong>{signupData.email || 'your email'}</strong></p>

      {status === 'success' ? (
        <div className={styles.statusContainer}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--color-success)', marginBottom: '1.5rem' }}>
            <Check size={36} />
          </div>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-success)', margin: 0 }}>Email verified successfully!</p>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} style={{ width: '100%' }}>
          <div className={styles.otpInputRow}>
            {code.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => (inputsRef.current[idx] = el)}
                type="text"
                pattern="[0-9]*"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(e, idx)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                className={`${styles.otpInput} ${error ? styles.inputError : ''}`}
                disabled={status === 'verifying'}
              />
            ))}
          </div>

          <div style={{ minHeight: '2rem', textAlign: 'center' }}>
            {error && (
              <div className={styles.errorText} style={{ justifyContent: 'center' }}><AlertCircle size={16} /> {error}</div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
            {timer > 0 ? (
              <span style={{ fontSize: '0.95rem', color: 'var(--color-text-muted)' }}>Resend code in {timer}s</span>
            ) : (
              <button 
                type="button" 
                onClick={handleResend}
                disabled={status === 'verifying'}
                style={{ background: 'none', border: 'none', color: status === 'verifying' ? 'var(--color-text-muted)' : 'var(--color-primary)', fontWeight: 600, cursor: status === 'verifying' ? 'not-allowed' : 'pointer', fontSize: '0.95rem' }}
              >
                Resend verification code
              </button>
            )}

            <button 
              type="submit" 
              className={styles.continueBtn}
              disabled={!isComplete || status === 'verifying'}
              style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
            >
              {status === 'verifying' ? (
                <>
                  Verifying... <Loader2 className={styles.btnIcon} style={{ animation: 'spin 1s linear infinite' }} />
                </>
              ) : (
                <>
                  Verify Code <ArrowRight className={styles.btnIcon} />
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </AnimatedStep>
  );
}
