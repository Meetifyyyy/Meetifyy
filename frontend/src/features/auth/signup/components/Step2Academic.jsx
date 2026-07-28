import React, { useState, useMemo, useEffect } from 'react';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, AlertCircle, Check, Loader2, X, WifiOff } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { MAJORS_LIST } from '../../../campus/data/majors';
import { apiClient } from '@shared/api/apiClient';
import styles from '../SignupFlow.module.css';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// emailStatus states:
//   null            → not checked yet
//   'checking'      → API in-flight
//   'available'     → confirmed free
//   'taken'         → confirmed registered
//   'network-error' → couldn't reach backend (soft — don't block)

export default function Step2Academic() {
  const { signupData, updateData, nextStep } = useSignup();

  const [email, setEmail] = useState(signupData.email || '');
  const [major, setMajor] = useState(signupData.course || signupData.branch || '');
  const [year, setYear] = useState(signupData.year || '');
  const [attempted, setAttempted] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);

  // ── Email format validation ────────────────────────────────────────────────
  const emailFormatError = useMemo(() => {
    if (!email) return 'College email is required.';
    if (!email.includes('@')) return 'Enter a valid email address.';
    if (!emailRegex.test(email)) return 'Please enter a valid email address.';
    const domain = email.split('@')[1] || '';
    if (
      !domain.endsWith('.edu') &&
      !domain.endsWith('.ac.in') &&
      !domain.endsWith('.org') &&
      !domain.endsWith('.com')
    ) {
      return 'Please enter a valid institution email.';
    }
    return null;
  }, [email]);

  // ── Real-time backend email check ─────────────────────────────────────────
  useEffect(() => {
    let active = true;

    if (!email || emailFormatError) {
      setEmailStatus(null);
      return;
    }

    setEmailStatus('checking');

    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.post('/api/auth/check-email', {
          email: email.trim().toLowerCase(),
        });
        if (!active) return;
        setEmailStatus(res?.available === true ? 'available' : 'taken');
      } catch {
        if (!active) return;
        // Network error — allow the user to continue. Backend catches real conflicts.
        setEmailStatus('network-error');
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [email, emailFormatError]);

  // ── Other field validation ─────────────────────────────────────────────────
  const majorError = useMemo(() => {
    if (!major.trim()) return 'Major is required.';
    if (major.trim().length < 2) return 'Enter a valid major name.';
    return null;
  }, [major]);

  const yearError = useMemo(() => {
    if (!year) return 'Year of passing is required.';
    return null;
  }, [year]);

  // ── Derived validity ──────────────────────────────────────────────────────
  const isChecking = emailStatus === 'checking';
  const isEmailBlocked = !!emailFormatError || emailStatus === 'taken';
  const isValid = !isEmailBlocked && !majorError && !yearError && !isChecking;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);

    if (isChecking) return;
    if (!isValid) return;

    // Final guard: if still unknown (null or network-error), do a blocking check
    let resolvedStatus = emailStatus;
    if (resolvedStatus === null || resolvedStatus === 'network-error') {
      setEmailStatus('checking');
      try {
        const res = await apiClient.post('/api/auth/check-email', {
          email: email.trim().toLowerCase(),
        });
        resolvedStatus = res?.available === false ? 'taken' : 'available';
        setEmailStatus(resolvedStatus);
      } catch {
        // Network still down — proceed, backend will handle conflicts
        resolvedStatus = 'network-error';
        setEmailStatus('network-error');
      }
    }

    if (resolvedStatus === 'taken') return;

    let university = 'University';
    const domain = email.toLowerCase().split('@')[1] || '';
    const domainPart = domain.split('.')[0];
    if (domainPart) {
      university = domainPart.charAt(0).toUpperCase() + domainPart.slice(1) + ' University';
    }

    updateData({
      email: email.trim().toLowerCase(),
      course: major,
      branch: major,
      year,
      university,
    });
    nextStep();
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => String(currentYear - 2 + i));

  const showEmailError = (attempted && emailFormatError) || emailStatus === 'taken';
  const activeEmailError =
    emailFormatError ||
    (emailStatus === 'taken' ? 'This email is already registered. Sign in instead.' : null);

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <h2 className={styles.headline}>Where do you study?</h2>
      <p className={styles.subheadline}>Provide your student credentials to connect with peers.</p>

      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {/* Email */}
        <div className={styles.inputGroup} style={{ position: 'relative' }}>
          <input
            id="email"
            type="email"
            className={`${styles.largeInput} ${showEmailError ? styles.inputError : ''}`}
            placeholder=" "
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ paddingRight: '2rem' }}
          />
          <label htmlFor="email" className={styles.floatingLabel}>College Email</label>

          {/* Status indicator */}
          <div style={{ position: 'absolute', right: '0.25rem', top: '1.15rem', display: 'flex', alignItems: 'center' }}>
            {emailStatus === 'checking' && (
              <Loader2 size={18} style={{ color: 'var(--color-primary)', animation: 'spin 1s linear infinite' }} />
            )}
            {emailStatus === 'available' && (
              <Check size={18} style={{ color: '#10b981' }} />
            )}
            {emailStatus === 'taken' && (
              <X size={18} style={{ color: '#ef4444' }} />
            )}
            {emailStatus === 'network-error' && (
              <WifiOff size={16} style={{ color: 'var(--color-text-muted)' }} />
            )}
          </div>

          <div className={styles.errorText} style={{ visibility: showEmailError ? 'visible' : 'hidden' }}>
            <AlertCircle size={14} /> {activeEmailError || ' '}
          </div>

          {emailStatus === 'network-error' && !showEmailError && (
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              Couldn't verify — you can still continue.
            </div>
          )}
        </div>

        {/* Major & Year row */}
        <div className={styles.academicRow} style={{ display: 'flex', gap: '1rem', width: '100%' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem', whiteSpace: 'nowrap' }}>
              Major / Course
            </label>
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
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem', whiteSpace: 'nowrap' }}>
              Year of Passing
            </label>
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
          disabled={isChecking}
          className={styles.continueBtn}
          style={{ width: '100%', justifyContent: 'center', marginTop: '1.5rem' }}
        >
          {isChecking ? (
            <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite', marginRight: '0.5rem' }} /> Checking...</>
          ) : (
            <>Continue <ArrowRight className={styles.btnIcon} /></>
          )}
        </button>
      </form>
    </AnimatedStep>
  );
}
