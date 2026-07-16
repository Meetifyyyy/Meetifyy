import React, { useState, useMemo } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, Check, AlertCircle } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { validateDOB } from '../../../../shared/utils/dateValidation';
import styles from '../SignupFlow.module.css';
import { initialUsers } from '@data/mockData';

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
    const y = year ? parseInt(year, 10) : 2024; // Default to leap year so 29 is possible before year is picked
    return new Date(y, m, 0).getDate();
  }, [month, year]);

  React.useEffect(() => {
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

  // Username Validation
  const existingUsernames = Object.keys(initialUsers);
  const usernameError = useMemo(() => {
    if (!username) return "Username is required.";
    if (username.includes(' ')) return "Usernames cannot contain spaces.";
    if (/[^a-z0-9_.]/.test(username)) return "Use lowercase letters, numbers, underscores, or periods.";
    if (username.length < 3) return "Username must be at least 3 characters.";
    if (existingUsernames.includes(username)) return "Username is already taken.";
    return null;
  }, [username]);

  // DOB Validation
  const dobValidation = useMemo(() => validateDOB(year, month, day), [year, month, day]);
  const dobError = dobValidation.error;

  const isValid = !nameError && !usernameError && !dobError;

  const handleSubmit = (e) => {
    e.preventDefault();
    setAttempted(true);
    if (isValid) {
      const parts = name.trim().split(' ');
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');
      updateData({
        firstName,
        lastName,
        username,
        birthday: dobValidation.dobString
      });
      nextStep();
    }
  };

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

        <div className={styles.inputGroup}>
          <input
            id="username"
            type="text"
            className={`${styles.largeInput} ${attempted && usernameError ? styles.inputError : ''}`}
            placeholder=" "
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
          />
          <label htmlFor="username" className={styles.floatingLabel}>Username</label>
          <div className={styles.errorText} style={{ visibility: attempted && usernameError ? 'visible' : 'hidden' }}>
            <AlertCircle size={14} /> {usernameError || ' '}
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
