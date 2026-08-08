import React, { useState, useMemo, useEffect } from 'react';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, Check, AlertCircle, Loader2, X, WifiOff } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { validateDOB } from '../../../../shared/utils/dateValidation';
import { useAvailabilityCheck } from '../hooks/useAvailabilityCheck';
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
    if (name.trim().length > 30) return 'Name cannot exceed 30 characters.';
    return null;
  }, [name]);

  // ── Local Username Format Validation ──────────────────────────────────────
  const usernameFormatError = useMemo(() => {
    if (!username) return 'Username is required.';
    if (username.includes(' ')) return 'Usernames cannot contain spaces.';
    if (/[^a-z0-9_.]/.test(username)) return 'Use lowercase letters, numbers, _ or .';
    if (username.length < 3) return 'At least 3 characters.';
    if (username.length > 30) return 'Username cannot exceed 30 characters.';
    return null;
  }, [username]);

  // ── Real-time Backend Availability Check ──────────────────────────────────
  // Cached + debounced + abortable. 'network-error' is treated as a soft state
  // (the real signup still catches conflicts), so it never blocks the user.
  const normalizedUsername = username.trim().toLowerCase();
  const { status: usernameStatus } = useAvailabilityCheck(normalizedUsername, {
    endpoint: '/api/auth/check-username',
    field: 'username',
    enabled: !usernameFormatError && normalizedUsername.length >= 3,
  });

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
          <div className={styles.inputWrapper}>
            <input
              id="name"
              type="text"
              className={`${styles.largeInput} ${attempted && nameError ? styles.inputError : ''}`}
              placeholder=" "
              value={name}
              maxLength={30}
              onChange={(e) => setName(e.target.value.slice(0, 30))}
            />
            <label htmlFor="name" className={styles.floatingLabel}>Full Name</label>
          </div>
          <div className={styles.errorText} style={{ visibility: attempted && nameError ? 'visible' : 'hidden' }}>
            <AlertCircle size={13} /> {nameError || ' '}
          </div>
        </div>

        {/* Username */}
        <div className={styles.inputGroup}>
          <div className={styles.inputWrapper}>
            <input
              id="username"
              type="text"
              className={`${styles.largeInput} ${showError ? styles.inputError : ''}`}
              placeholder=" "
              value={username}
              maxLength={30}
              onChange={(e) => {
                const val = e.target.value.toLowerCase().slice(0, 30);
                if (val !== '' && /[^a-z0-9_.]/.test(val)) return;
                setUsername(val);
              }}
              style={{ paddingRight: '2.5rem' }}
            />
            <label htmlFor="username" className={styles.floatingLabel}>Username</label>

            {/* Status indicator */}
            <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
              {usernameStatus === 'checking' && (
                <Loader2 size={16} style={{ color: 'var(--color-primary)', animation: 'spin 1s linear infinite' }} />
              )}
              {usernameStatus === 'available' && (
                <Check size={16} style={{ color: '#10b981' }} />
              )}
              {usernameStatus === 'taken' && (
                <X size={16} style={{ color: '#ef4444' }} />
              )}
              {usernameStatus === 'network-error' && (
                <WifiOff size={15} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </div>
          </div>

          {/* Error text */}
          <div
            className={styles.errorText}
            style={{ visibility: showError ? 'visible' : 'hidden' }}
          >
            <AlertCircle size={13} /> {activeUsernameError || ' '}
          </div>

          {/* Network error hint — shown inline, not as a blocking error */}
          {usernameStatus === 'network-error' && !showError && (
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              Couldn't verify availability — you can still continue.
            </div>
          )}
        </div>

        {/* Date of Birth */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.35rem' }}>
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
              options={Array.from({ length: new Date().getFullYear() - 1950 + 1 }, (_, i) => new Date().getFullYear() - i).map(y => ({
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
          style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
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
