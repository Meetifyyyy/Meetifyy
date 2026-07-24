import React, { useState, useMemo, useEffect } from 'react';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, AlertCircle, Check, Loader2, X } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { MAJORS_LIST } from '../../../campus/data/majors';
import { apiClient } from '@shared/api/apiClient';
import styles from '../SignupFlow.module.css';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Step2Academic() {
  const { signupData, updateData, nextStep } = useSignup();

  const [email, setEmail] = useState(signupData.email || '');
  const [major, setMajor] = useState(signupData.course || signupData.branch || '');
  const [year, setYear] = useState(signupData.year || '');
  const [attempted, setAttempted] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [emailAvailability, setEmailAvailability] = useState(null);

  const emailError = useMemo(() => {
    if (!email) return "College email is required.";
    if (!email.includes('@')) return "Enter a valid email address.";
    if (!emailRegex.test(email)) return "Please enter a valid email address.";
    const domain = email.split('@')[1] || '';
    if (!domain.endsWith('.edu') && !domain.endsWith('.ac.in') && !domain.endsWith('.org') && !domain.endsWith('.com')) {
      return "Please enter a valid institution email.";
    }
    return null;
  }, [email]);

  useEffect(() => {
    let active = true;

    if (!email || emailError) {
      setIsCheckingEmail(false);
      setEmailAvailability(null);
      return;
    }

    setIsCheckingEmail(true);
    setEmailAvailability(null);

    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.post('/api/auth/check-email', { email: email.trim().toLowerCase() });
        if (active && res) {
          setEmailAvailability(res);
        }
      } catch (err) {
        if (active) {
          setEmailAvailability({ available: false, reason: 'This email is already registered.' });
        }
      } finally {
        if (active) {
          setIsCheckingEmail(false);
        }
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [email, emailError]);

  const activeEmailError = emailError || (emailAvailability && !emailAvailability.available ? emailAvailability.reason : null);

  const majorError = useMemo(() => {
    if (!major.trim()) return "Major is required.";
    if (major.trim().length < 2) return "Enter a valid major name.";
    return null;
  }, [major]);

  const yearError = useMemo(() => {
    if (!year) return "Year of passing is required.";
    return null;
  }, [year]);

  const isEmailValid = !emailError && (emailAvailability ? emailAvailability.available : true);
  const isValid = isEmailValid && !majorError && !yearError && !isCheckingEmail;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);

    if (emailError || majorError || yearError) return;

    try {
      setIsCheckingEmail(true);
      const res = await apiClient.post('/api/auth/check-email', { email: email.trim().toLowerCase() });
      if (res && !res.available) {
        setEmailAvailability(res);
        return;
      }
    } catch (err) {
      // Proceed if check fails due to network offline
    } finally {
      setIsCheckingEmail(false);
    }

    if (isValid && emailAvailability?.available !== false) {
      let university = 'GLA University';
      const domain = email.toLowerCase().split('@')[1] || '';
      if (domain === 'stanford.edu' || domain.endsWith('.stanford.edu')) {
        university = 'Stanford University';
      } else if (domain === 'mit.edu' || domain.endsWith('.mit.edu')) {
        university = 'MIT';
      } else if (domain === 'gla.ac.in' || domain.endsWith('.gla.ac.in') || domain === 'gla.in') {
        university = 'GLA University';
      } else {
        const parts = domain.split('.')[0];
        university = parts.charAt(0).toUpperCase() + parts.slice(1) + ' University';
      }

      updateData({
        email: email.trim().toLowerCase(),
        course: major,
        branch: major,
        year,
        university
      });
      nextStep();
    }
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => String(currentYear - 2 + i));

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <h2 className={styles.headline}>Where do you study?</h2>
      <p className={styles.subheadline}>Provide your student credentials to connect with peers.</p>

      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div className={styles.inputGroup} style={{ position: 'relative' }}>
          <input
            id="email"
            type="email"
            className={`${styles.largeInput} ${(attempted && activeEmailError) || (emailAvailability && !emailAvailability.available) ? styles.inputError : ''}`}
            placeholder=" "
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ paddingRight: '2rem' }}
          />
          <label htmlFor="email" className={styles.floatingLabel}>College Email</label>

          <div style={{ position: 'absolute', right: '0.25rem', top: '1.15rem', display: 'flex', alignItems: 'center' }}>
            {isCheckingEmail && (
              <Loader2 size={18} style={{ color: 'var(--color-primary)', animation: 'spin 1s linear infinite' }} />
            )}
            {!isCheckingEmail && emailAvailability && emailAvailability.available && (
              <Check size={18} style={{ color: '#10b981' }} />
            )}
            {!isCheckingEmail && emailAvailability && !emailAvailability.available && (
              <X size={18} style={{ color: '#ef4444' }} />
            )}
          </div>

          <div className={styles.errorText} style={{ visibility: (attempted && activeEmailError) || (emailAvailability && !emailAvailability.available) ? 'visible' : 'hidden' }}>
            <AlertCircle size={14} /> {activeEmailError || ' '}
          </div>
        </div>

        <div className={styles.academicRow} style={{ display: 'flex', gap: '1rem', width: '100%' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem', whiteSpace: 'nowrap' }}>Major / Course</label>
            <CustomSelect 
              value={major} 
              onChange={setMajor}
              placeholder="Select Major"
              options={MAJORS_LIST} 
              searchable={true}
            />
            <div className={styles.errorText} style={{ visibility: attempted && majorError ? 'visible' : 'hidden' }}>
              <AlertCircle size={14} /> {majorError || ' '}
            </div>
          </div>

          <div style={{ flex: '0 0 135px', minWidth: '135px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem', whiteSpace: 'nowrap' }}>Year of Passing</label>
            <CustomSelect 
              value={year} 
              onChange={setYear}
              placeholder="Select Year"
              options={years.map(y => ({ value: y, label: y }))} 
            />
            <div className={styles.errorText} style={{ visibility: attempted && yearError ? 'visible' : 'hidden' }}>
              <AlertCircle size={14} /> {yearError || ' '}
            </div>
          </div>
        </div>

        <button 
          type="submit" 
          disabled={isCheckingEmail}
          className={styles.continueBtn}
          style={{ width: '100%', justifyContent: 'center', marginTop: '1.5rem' }}
        >
          Continue <ArrowRight className={styles.btnIcon} />
        </button>
      </form>
    </AnimatedStep>
  );
}
