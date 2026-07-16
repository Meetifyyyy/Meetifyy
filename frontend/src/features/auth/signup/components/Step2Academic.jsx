import React, { useState, useMemo } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, AlertCircle } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { MAJORS_LIST } from '../../../campus/data/majors';
import styles from '../SignupFlow.module.css';

export default function Step2Academic() {
  const { signupData, updateData, nextStep } = useSignup();

  const [email, setEmail] = useState(signupData.email || '');
  const [major, setMajor] = useState(signupData.course || signupData.branch || '');
  const [year, setYear] = useState(signupData.year || '');
  const [attempted, setAttempted] = useState(false);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  const emailError = useMemo(() => {
    if (!email) return "College email is required.";
    if (!email.includes('@')) return "Enter a valid email address.";
    if (!emailRegex.test(email)) return "Please enter a valid email address.";
    // Check for college domain extension optionally
    const domain = email.split('@')[1] || '';
    if (!domain.endsWith('.edu') && !domain.endsWith('.ac.in') && !domain.endsWith('.org') && !domain.endsWith('.com')) {
      return "Please enter a valid institution email.";
    }
    return null;
  }, [email]);

  const majorError = useMemo(() => {
    if (!major.trim()) return "Major is required.";
    if (major.trim().length < 2) return "Enter a valid major name.";
    return null;
  }, [major]);

  const yearError = useMemo(() => {
    if (!year) return "Year of passing is required.";
    return null;
  }, [year]);

  const isValid = !emailError && !majorError && !yearError;

  const handleSubmit = (e) => {
    e.preventDefault();
    setAttempted(true);
    if (isValid) {
      // Deducing university from email domain or fallback
      let university = 'GLA University';
      const domain = email.toLowerCase().split('@')[1] || '';
      if (domain.includes('stanford')) {
        university = 'Stanford University';
      } else if (domain.includes('mit')) {
        university = 'MIT';
      } else if (domain.includes('gla')) {
        university = 'GLA University';
      } else {
        // extract first part of domain and capitalize
        const parts = domain.split('.')[0];
        university = parts.charAt(0).toUpperCase() + parts.slice(1) + ' University';
      }

      updateData({
        email,
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
        <div className={styles.inputGroup}>
          <input
            id="email"
            type="email"
            className={`${styles.largeInput} ${attempted && emailError ? styles.inputError : ''}`}
            placeholder=" "
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="email" className={styles.floatingLabel}>College Email</label>
          <div className={styles.errorText} style={{ visibility: attempted && emailError ? 'visible' : 'hidden' }}>
            <AlertCircle size={14} /> {emailError || ' '}
          </div>
        </div>

        <div className={styles.academicRow}>
          <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem' }}>Major / Course</label>
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

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem' }}>Year of Passing</label>
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
          className={styles.continueBtn}
          style={{ width: '100%', justifyContent: 'center', marginTop: '1.5rem' }}
        >
          Continue <ArrowRight className={styles.btnIcon} />
        </button>
      </form>
    </AnimatedStep>
  );
}
