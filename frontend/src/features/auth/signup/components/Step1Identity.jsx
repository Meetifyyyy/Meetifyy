import React, { useState, useMemo, useEffect } from 'react';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, Check, AlertCircle, Loader2, X } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { validateDOB } from '../../../../shared/utils/dateValidation';
import { apiClient } from '@shared/api/apiClient';
import styles from '../SignupFlow.module.css';

export default function Step1Identity() {
  const { signupData, updateData, nextStep } = useSignup();
  
  const [name, setName] = useState(signupData.firstName ? `${signupData.firstName} ${signupData.lastName || ''}`.trim() : '');
  const [username, setUsername] = useState(signupData.username || '');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailability, setUsernameAvailability] = useState(null); // null | { available: boolean, reason?: string }

  const initialDob = signupData.birthday || '';
  const initialParts = initialDob ? initialDob.split('-') : ['', '', ''];
  const [year, setYear] = useState(initialParts[0]);
  const [month, setMonth] = useState(initialParts[1]);
  const [day, setDay] = useState(initialParts[2]);
  const [attempted, setAttempted] = useState(false);

  const daysInMonth = useMemo(() => {
    if (!month) return 31;
    const m = parseInt(month, 10);
    const y = year ? parseInt(year, 10) : 2024; // Default to leap year so 29 is possible before year is picked
    return new Date(y, m, 0).getDate();
  }, [month, year]);

  useEffect(() => {
    if (day && parseInt(day, 10) > daysInMonth) {
      setDay('');
    }
  }, [daysInMonth, day]);

  // Name Validation
  const nameError = useMemo(() => {
    if (!name) return "Name is required.";
    if (/\d/.test(name)) return "Names cannot contain numbers.";
    if (/[!@#$%^&*(),.?":{}|<>]/.test(name)) return "Names cannot contain special characters.";
    if (name.trim().length < 2) return "Please enter a valid name.";
    return null;
  }, [name]);

  // Local Username Validation
  const usernameError = useMemo(() => {
    if (!username) return "Username is required.";
    if (username.includes(' ')) return "Usernames cannot contain spaces.";
    if (/[^a-z0-9_.]/.test(username)) return "Use lowercase letters, numbers, underscores, or periods.";
    if (username.length < 3) return "Username must be at least 3 characters.";
    return null;
  }, [username]);

  // Real-time Backend Username Availability Check
  useEffect(() => {
    let active = true;

    if (!username || username.trim().length < 3 || usernameError) {
      setIsCheckingUsername(false);
      setUsernameAvailability(null);
      return;
    }

    setIsCheckingUsername(true);
    setUsernameAvailability(null);

    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.post('/api/auth/check-username', { username: username.trim().toLowerCase() });
        if (active && res) {
          setUsernameAvailability(res);
        }
      } catch (err) {
        if (active) {
          setUsernameAvailability({ available: false, reason: 'Username not available' });
        }
      } finally {
        if (active) {
          setIsCheckingUsername(false);
        }
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username, usernameError]);

  // DOB Validation
  const dobValidation = useMemo(() => validateDOB(year, month, day), [year, month, day]);
  const dobError = dobValidation.error;

  const isUsernameValid = !usernameError && (usernameAvailability ? usernameAvailability.available : true);
  const isValid = !nameError && isUsernameValid && !dobError && !isCheckingUsername;

  const handleSubmit = (e) => {
    e.preventDefault();
    setAttempted(true);
    if (isValid && usernameAvailability?.available) {
      const parts = name.trim().split(' ');
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');
      updateData({
        firstName,
        lastName,
        username: username.trim().toLowerCase(),
        birthday: dobValidation.dobString
      });
      nextStep();
    }
  };

  const activeUsernameError = usernameError || (usernameAvailability && !usernameAvailability.available ? usernameAvailability.reason : null);

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <h2 className={styles.headline}>Tell us about yourself</h2>
      <p className={styles.subheadline}>Let's start with the basics to set up your profile.</p>
      
      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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

        <div className={styles.inputGroup} style={{ position: 'relative' }}>
          <input
            id="username"
            type="text"
            className={`${styles.largeInput} ${(attempted && activeUsernameError) || (usernameAvailability && !usernameAvailability.available) ? styles.inputError : ''}`}
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

          {/* Real-time Availability Indicator */}
          <div style={{ position: 'absolute', right: '0.25rem', top: '1.15rem', display: 'flex', alignItems: 'center' }}>
            {isCheckingUsername && (
              <Loader2 size={18} style={{ color: 'var(--color-primary)', animation: 'spin 1s linear infinite' }} />
            )}
            {!isCheckingUsername && usernameAvailability && usernameAvailability.available && (
              <Check size={18} style={{ color: '#10b981' }} />
            )}
            {!isCheckingUsername && usernameAvailability && !usernameAvailability.available && (
              <X size={18} style={{ color: '#ef4444' }} />
            )}
          </div>

          <div className={styles.errorText} style={{ visibility: (attempted && activeUsernameError) || (usernameAvailability && !usernameAvailability.available) ? 'visible' : 'hidden' }}>
            <AlertCircle size={14} /> {activeUsernameError || ' '}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: '0.25rem', marginBottom: '0.25rem' }}>Date of Birth</label>
          <div className={styles.dateSelectRow}>
            <CustomSelect 
              value={month} 
              onChange={setMonth}
              placeholder="Month"
              options={Array.from({ length: 12 }, (_, i) => i + 1).map(m => ({ 
                value: m, 
                label: new Date(0, m - 1).toLocaleString('default', { month: 'short' }) 
              }))} 
            />
            <CustomSelect 
              value={day} 
              onChange={setDay}
              placeholder="Day"
              options={Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => ({ 
                value: d, 
                label: d 
              }))} 
            />
            <CustomSelect 
              value={year} 
              onChange={setYear}
              placeholder="Year"
              options={Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map(y => ({ 
                value: y, 
                label: y 
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
        >
          Continue <ArrowRight className={styles.btnIcon} />
        </button>
      </form>
    </AnimatedStep>
  );
}
