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
  const [emailReason, setEmailReason] = useState('');

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
      setEmailReason('');
      return;
    }

    setEmailStatus('checking');

    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.post('/api/auth/check-email', {
          email: email.trim().toLowerCase(),
        });
        if (!active) return;
        if (res?.available === true) {
          setEmailStatus('available');
          setEmailReason('');
        } else {
          setEmailStatus('taken');
          setEmailReason(res?.reason || 'This email is already registered. Please sign in.');
        }
      } catch {
        if (!active) return;
        // Network error — allow the user to continue. Backend catches real conflicts.
        setEmailStatus('network-error');
        setEmailReason('');
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [email, emailFormatError]);

  const currentYear = new Date().getFullYear();
  const maxPassingYear = currentYear + 6;
  const years = useMemo(() => {
    const list = [];
    for (let y = 2026; y <= maxPassingYear; y++) {
      list.push(String(y));
    }
    return list;
  }, [maxPassingYear]);

  const showEmailError = (attempted && emailFormatError) || emailStatus === 'taken';
  const activeEmailError =
    emailFormatError ||
    (emailStatus === 'taken' ? (emailReason || 'This email is already registered. Please sign in.') : null);

  const majorError = !major.trim() ? 'Major / Course is required.' : null;
  const yearError = useMemo(() => {
    if (!year) return 'Year is required.';
    const num = parseInt(year, 10);
    if (isNaN(num) || num < 2026 || num > maxPassingYear) {
      return `Must be 2026–${maxPassingYear}.`;
    }
    return null;
  }, [year, maxPassingYear]);

  const isChecking = emailStatus === 'checking';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);

    if (emailFormatError || majorError || yearError) return;

    // Final guard: if still unknown (null or network-error), do a blocking check
    let resolvedStatus = emailStatus;
    let resolvedReason = emailReason;
    if (resolvedStatus === null || resolvedStatus === 'network-error') {
      setEmailStatus('checking');
      try {
        const res = await apiClient.post('/api/auth/check-email', {
          email: email.trim().toLowerCase(),
        });
        if (res?.available === false) {
          resolvedStatus = 'taken';
          resolvedReason = res?.reason || 'This email is already registered. Please sign in.';
        } else {
          resolvedStatus = 'available';
          resolvedReason = '';
        }
        setEmailStatus(resolvedStatus);
        setEmailReason(resolvedReason);
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

  return (
    <AnimatedStep key="step2" className={styles.stepWrapper}>
      <h2 className={styles.headline}>Academic Details</h2>
      <p className={styles.subheadline}>Connect with peers at your institution</p>

      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {/* Email */}
        <div className={styles.inputGroup}>
          <div className={styles.inputWrapper}>
            <input
              id="email"
              type="email"
              className={`${styles.largeInput} ${showEmailError ? styles.inputError : ''}`}
              placeholder=" "
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ paddingRight: '2.5rem' }}
            />
            <label htmlFor="email" className={styles.floatingLabel}>College Email</label>

            {/* Status indicator */}
            <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
              {emailStatus === 'checking' && (
                <Loader2 size={16} style={{ color: 'var(--color-primary)', animation: 'spin 1s linear infinite' }} />
              )}
              {emailStatus === 'available' && (
                <Check size={16} style={{ color: '#10b981' }} />
              )}
              {emailStatus === 'taken' && (
                <X size={16} style={{ color: '#ef4444' }} />
              )}
              {emailStatus === 'network-error' && (
                <WifiOff size={15} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </div>
          </div>

          <div className={styles.errorText} style={{ visibility: showEmailError ? 'visible' : 'hidden', minHeight: '20px' }}>
            <AlertCircle size={13} /> {activeEmailError || ' '}
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
            <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem', whiteSpace: 'nowrap' }}>
              Major / Course
            </label>
            <CustomSelect
              value={major}
              onChange={setMajor}
              placeholder="Select Major"
              options={MAJORS_LIST}
              searchable={true}
            />
            <div className={styles.errorText} style={{ visibility: attempted && majorError ? 'visible' : 'hidden', minHeight: '20px' }}>
              <AlertCircle size={13} /> {majorError || ' '}
            </div>
          </div>

          <div style={{ flex: '0 0 135px', minWidth: '135px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem', whiteSpace: 'nowrap' }}>
              Year of Passing
            </label>
            <CustomSelect
              value={year}
              onChange={setYear}
              placeholder="Select Year"
              options={years.map(y => ({ value: y, label: y }))}
              searchable={true}
            />
            <div className={styles.errorText} style={{ visibility: attempted && yearError ? 'visible' : 'hidden', minHeight: '20px' }}>
              <AlertCircle size={13} /> {yearError || ' '}
            </div>
          </div>
        </div>

        <button
          type="submit"
          className={styles.continueBtn}
          style={{ width: '100%', justifyContent: 'center', marginTop: '1.5rem' }}
          disabled={isChecking}
        >
          {isChecking ? (
            <>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Checking...</span>
            </>
          ) : (
            <>
              <span>Continue</span>
              <ArrowRight size={18} className={styles.btnIcon} />
            </>
          )}
        </button>
      </form>
    </AnimatedStep>
  );
}
