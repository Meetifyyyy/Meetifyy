import React, { useState, useMemo } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, AlertCircle, GraduationCap } from 'lucide-react';
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)', marginBottom: '1rem' }}>
        <GraduationCap size={24} />
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Academic Details</span>
      </div>
      <h2 className={styles.headline}>Where do you study?</h2>
      <p className={styles.subheadline}>Provide your student credentials to connect with peers.</p>

      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>College Email</label>
          <input
            type="email"
            className={`${styles.largeInput} ${attempted && emailError ? styles.inputError : ''}`}
            placeholder="name@college.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ fontSize: '1.35rem', padding: '0.35rem 0', margin: '0.25rem 0 0 0' }}
          />
          {attempted && emailError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={14} /> {emailError}</div>
          )}
        </div>

        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Major / Course</label>
          <input
            type="text"
            className={`${styles.largeInput} ${attempted && majorError ? styles.inputError : ''}`}
            placeholder="e.g. Computer Science"
            value={major}
            onChange={(e) => setMajor(e.target.value)}
            style={{ fontSize: '1.35rem', padding: '0.35rem 0', margin: '0.25rem 0 0 0' }}
          />
          {attempted && majorError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={14} /> {majorError}</div>
          )}
        </div>

        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>Year of Passing</label>
          <select
            className={`${styles.largeInput} ${attempted && yearError ? styles.inputError : ''}`}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={{ 
              fontSize: '1.35rem', 
              padding: '0.35rem 0', 
              margin: '0.25rem 0 0 0', 
              border: 'none',
              borderBottom: '2px solid var(--color-border)',
              background: 'transparent',
              width: '100%',
              outline: 'none',
              color: year ? 'var(--color-text-main)' : 'var(--color-text-light)'
            }}
          >
            <option value="" disabled style={{ color: 'var(--color-text-light)' }}>Select Year</option>
            {years.map((y) => (
              <option key={y} value={y} style={{ color: 'var(--color-text-main)', background: 'var(--color-bg-white)' }}>{y}</option>
            ))}
          </select>
          {attempted && yearError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={14} /> {yearError}</div>
          )}
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
