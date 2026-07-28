import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, Check, AlertCircle, Loader2, X, WifiOff } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { validateDOB } from '../../../../shared/utils/dateValidation';
import { apiClient } from '@shared/api/apiClient';
import styles from '../SignupFlow.module.css';

// usernameStatus states:
//   null           → not yet checked (input too short / still debouncing)
//   'checking'     → API call in-flight
//   'available'    → backend confirmed available
//   'taken'        → backend confirmed taken
//   'network-error'→ could not reach backend (don't block user)

export default function Step1Identity() {
  const { signupData, updateData, nextStep } = useSignup();
  
  const [name, setName] = useState(signupData.firstName ? `${signupData.firstName} ${signupData.lastName || ''}`.trim() : '');
  const [username, setUsername] = useState(signupData.username || '');
  const [usernameStatus, setUsernameStatus] = useState(null);

  const initialDob = signupData.birthday || '';
  const initialParts = initialDob ? initialDob.split('-') : ['', '', ''];
  const [year, setYear] = useState(initialParts[0]);
  const [month, setMonth] = useState(initialParts[1]);
  const [day, setDay] = useState(initialParts[2]);
  const [attempted, setAttempted] = useState(false);

  const daysInMonth = useMemo(() => {
    if (!month) return 31;
    const m = parseInt(month, 10);
    const y = year ? parseInt(year, 10) : 2024;
    return new Date(y, m, 0).getDate();
  }, [month, year]);

  useEffect(() => {
    if (day && parseInt(day, 10) > daysInMonth) {
      setDay('');
    }
  }, [daysInMonth, day]);

  // ── Name Validation ────────────────────────────────────────────────────────
  const nameError = useMemo(() => {
    if (!name) return 'Name is required.';
    if (/\d/.test(name)) return 'Names cannot contain numbers.';
    if (/[!@#$%^&*(),.?":{}|<>]/.test(name)) return 'Names cannot contain special characters.';
    if (name.trim().length < 2) return 'Please enter a valid name.';
    return null;
  }, [name]);

  // ── Local Username Format Validation ──────────────────────────────────────
  const usernameFormatError = useMemo(() => {
    if (!username) return 'Username is required.';
    if (username.includes(' ')) return 'Usernames cannot contain spaces.';
    if (/[^a-z0-9_.]/.test(username)) return 'Use lowercase letters, numbers, _ or .';
    if (username.length < 3) return 'At least 3 characters.';
    return null;
  }, [username]);

  // ── Real-time Backend Availability Check ──────────────────────────────────
  useEffect(() => {
    let active = true;

    // If format is invalid, no point hitting the backend
    if (!username || username.trim().length < 3 || usernameFormatError) {
      setUsernameStatus(null);
      return;
    }

    setUsernameStatus('checking');

    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.post('/api/auth/check-username', {
          username: username.trim().toLowerCase(),
        });
        if (!active) return;
        // Backend returns { available: true } or { available: false, reason }
        setUsernameStatus(res?.available === true ? 'available' : 'taken');
      } catch (err) {
        if (!active) return;
        // Network / server error — don't penalise the user.
        // The actual signup will catch real conflicts.
        setUsernameStatus('network-error');
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username, usernameFormatError]);

  // ── DOB Validation ────────────────────────────────────────────────────────
  const dobValidation = useMemo(() => validateDOB(year, month, day), [year, month, day]);
  const dobError = dobValidation.error;

  // ── Derived validity ──────────────────────────────────────────────────────
  const isChecking = usernameStatus === 'checking';
  // 'taken' is the only hard block. null / 'network-error' are soft — let the user proceed.
  const isUsernameBlocked = !!usernameFormatError || usernameStatus === 'taken';
  const isValid = !nameError && !isUsernameBlocked && !dobError && !isChecking;

  const handleSubmit = (e) => {
    e.preventDefault();
    setAttempted(true);

    // Still waiting for the debounced check to resolve — soft block
    if (isChecking) return;

    if (isValid) {
      const parts = name.trim().split(' ');
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');
      updateData({
        firstName,
        lastName,
        username: username.trim().toLowerCase(),
        birthday: dobValidation.dobString,
      });
      nextStep();
    }
  };

  // ── Derived UI state ──────────────────────────────────────────────────────
  const showError =
    (attempted && usernameFormatError) ||
    usernameStatus === 'taken';

  const activeUsernameError =
    usernameFormatError ||
    (usernameStatus === 'taken' ? 'Username not available' : null);

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <h2 className={styles.headline}>Tell us about yourself</h2>
      <p className={styles.subheadline}>Let's start with the basics to set up your profile.</p>
      
      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {/* Full Name */}
        <div className={styles.inputGroup}>
          <input
            id="name"
            type="text"
            className={`${styles.largeInput} ${attempted && nameError ? styles.inputError : ''}`}
            placeholder=" "
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="name" className={styles.floatingLabel}>Full Name</label>
          <div className={styles.errorText} style={{ visibility: attempted && nameError ? 'visible' : 'hidden' }}>
            <AlertCircle size={14} /> {nameError || ' '}
          </div>
        </div>

        {/* Username */}
        <div className={styles.inputGroup} style={{ position: 'relative' }}>
          <input
            id="username"
            type="text"
            className={`${styles.largeInput} ${showError ? styles.inputError : ''}`}
            placeholder=" "
            value={username}
            onChange={(e) => {
              const val = e.target.value.toLowerCase();
              if (val !== '' && /[^a-z0-9_.]/.test(val)) return;
              setUsername(val);
            }}
            style={{ paddingRight: '2rem' }}
          />
          <label htmlFor="username" className={styles.floatingLabel}>Username</label>

          {/* Status indicator */}
          <div style={{ position: 'absolute', right: '0.25rem', top: '1.15rem', display: 'flex', alignItems: 'center' }}>
            {usernameStatus === 'checking' && (
              <Loader2 size={18} style={{ color: 'var(--color-primary)', animation: 'spin 1s linear infinite' }} />
            )}
            {usernameStatus === 'available' && (
              <Check size={18} style={{ color: '#10b981' }} />
            )}
            {usernameStatus === 'taken' && (
              <X size={18} style={{ color: '#ef4444' }} />
            )}
            {usernameStatus === 'network-error' && (
              <WifiOff size={16} style={{ color: 'var(--color-text-muted)' }} />
            )}
          </div>

          {/* Error text */}
          <div
            className={styles.errorText}
            style={{ visibility: showError ? 'visible' : 'hidden' }}
          >
            <AlertCircle size={14} /> {activeUsernameError || ' '}
          </div>

          {/* Network error hint — shown inline, not as a blocking error */}
          {usernameStatus === 'network-error' && !showError && (
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              Couldn't verify availability — you can still continue.
            </div>
          )}
        </div>

        {/* Date of Birth */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem' }}>
            Date of Birth
          </label>
          <div className={styles.dateSelectRow}>
            <CustomSelect
              value={month}
              onChange={setMonth}
              placeholder="Month"
              options={Array.from({ length: 12 }, (_, i) => i + 1).map(m => ({
                value: m,
                label: new Date(0, m - 1).toLocaleString('default', { month: 'short' }),
              }))}
            />
            <CustomSelect
              value={day}
              onChange={setDay}
              placeholder="Day"
              options={Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => ({
                value: d,
                label: d,
              }))}
            />
            <CustomSelect
              value={year}
              onChange={setYear}
              placeholder="Year"
              options={Array.from({ length: new Date().getFullYear() - 1990 + 1 }, (_, i) => new Date().getFullYear() - i).map(y => ({
                value: y,
                label: y,
              }))}
            />
          </div>
          <div className={styles.errorText} style={{ visibility: attempted && dobError ? 'visible' : 'hidden' }}>
            <AlertCircle size={14} /> {dobError || ' '}
          </div>
        </div>

        <button
          type="submit"
          className={styles.continueBtn}
          style={{ width: '100%', justifyContent: 'center', marginTop: '1.5rem' }}
          disabled={isChecking}
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
