import React, { useState, useRef, useMemo } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, AlertCircle } from 'lucide-react';
import styles from '../SignupFlow.module.css';
import { initialUsers } from '../../../data/mockData';

export default function Step2Identity() {
  const { signupData, updateData, nextStep } = useSignup();
  const [subStep, setSubStep] = useState(1);
  
  const [localName, setLocalName] = useState(signupData.firstName ? `${signupData.firstName} ${signupData.lastName}`.trim() : '');
  const [localUsername, setLocalUsername] = useState(signupData.username || '');
  
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  
  // Track if user attempted to proceed to show errors even if fields are empty
  const [birthdaySubmitAttempted, setBirthdaySubmitAttempted] = useState(false);

  const monthRef = useRef(null);
  const yearRef = useRef(null);

  // Name Validation
  const nameError = useMemo(() => {
    if (!localName) return null;
    if (/\d/.test(localName)) return "Names cannot contain numbers.";
    if (/[!@#$%^&*(),.?":{}|<>]/.test(localName)) return "Names cannot contain special characters.";
    if (localName.trim().length < 2 && localName.length > 0) return "Please enter a valid name.";
    return null;
  }, [localName]);

  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!nameError && localName.trim().length > 1) {
      const parts = localName.trim().split(' ');
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');
      updateData({ firstName, lastName });
      setSubStep(2);
    }
  };

  // Username Validation
  const existingUsernames = Object.keys(initialUsers);
  
  const usernameError = useMemo(() => {
    if (!localUsername) return null;
    if (localUsername.includes(' ')) return "Usernames cannot contain spaces.";
    if (/[^a-z0-9_.]/.test(localUsername)) return "Usernames can only contain lowercase letters, numbers, underscores, and periods.";
    if (localUsername.length > 0 && localUsername.length < 3) return "Username must be at least 3 characters long.";
    if (existingUsernames.includes(localUsername)) return "This username is already taken. Try adding numbers.";
    return null;
  }, [localUsername]);

  const handleUsernameSubmit = (e) => {
    e.preventDefault();
    if (!usernameError && localUsername.trim().length >= 3) {
      updateData({ username: localUsername });
      setSubStep(3);
    }
  };

  // Birthday Validation Logic
  const birthdayError = useMemo(() => {
    // Basic presence check
    if (!day && !month && !year) {
      return "Please enter your date of birth.";
    }

    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);

    // 1. Month validation (As user types)
    if (month.length > 0) {
      if (isNaN(m) || m < 1 || m > 12) return "Please enter a valid month between 1 and 12.";
    }

    // 2. Day validation (Basic bounds)
    if (day.length > 0) {
      if (isNaN(d) || d < 1 || d > 31) return "Please enter a valid day.";
    }

    // 3. Year validation (Wait until 4 digits usually, but block obvious bad starts if possible)
    if (year.length === 4) {
      if (isNaN(y) || y < 1900) return "Please enter a valid birth year.";
      if (y > new Date().getFullYear()) return "Year cannot be in the future.";
    }

    // 4. Complete Date validation (when all fields are populated)
    if (day.length > 0 && month.length > 0 && year.length === 4) {
      const isLeapYear = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      
      if (m >= 1 && m <= 12) {
        const maxDays = daysInMonth[m - 1];
        if (d > maxDays) {
          if (m === 2 && d === 29 && !isLeapYear) {
             return "February 29 is only available during leap years.";
          }
          if (m === 2) {
             return `February does not have ${d} days.`;
          }
          return "Please enter a valid day for the selected month.";
        }
      }

      // Age calculation
      const today = new Date();
      const birthDate = new Date(y, m - 1, d);
      
      let age = today.getFullYear() - birthDate.getFullYear();
      const mDiff = today.getMonth() - birthDate.getMonth();
      
      // If the birth month is ahead of the current month, or it's the birth month but the day hasn't occurred yet
      if (mDiff < 0 || (mDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      
      if (age < 18) {
        return "You must be at least 18 years old to join Meetifyy.";
      }
      
      return null; // All valid!
    } 

    // 5. Incomplete Field Messages
    if (day.length > 0 || month.length > 0 || year.length > 0) {
      if (year.length > 0 && year.length < 4) return "Please complete your birth year.";
      if (!day) return "Please complete your birth day.";
      if (!month) return "Please complete your birth month.";
    }

    return "Please complete your birth date.";
  }, [day, month, year]);

  const handleBirthdaySubmit = (e) => {
    e.preventDefault();
    setBirthdaySubmitAttempted(true);
    
    if (!birthdayError) {
      // Pad single digits
      const paddedMonth = month.padStart(2, '0');
      const paddedDay = day.padStart(2, '0');
      updateData({ birthday: `${year}-${paddedMonth}-${paddedDay}` });
      nextStep();
    }
  };

  const handleDayChange = (e) => {
    const val = e.target.value.replace(/\D/g, '');
    setDay(val);
    if (val.length === 2 && parseInt(val, 10) >= 1) monthRef.current?.focus();
    // Clear attempt flag when user types so real-time errors take over
    if (birthdaySubmitAttempted) setBirthdaySubmitAttempted(false);
  };

  const handleMonthChange = (e) => {
    const val = e.target.value.replace(/\D/g, '');
    setMonth(val);
    if (val.length === 2 && parseInt(val, 10) >= 1) yearRef.current?.focus();
    if (birthdaySubmitAttempted) setBirthdaySubmitAttempted(false);
  };

  const handleYearChange = (e) => {
    const val = e.target.value.replace(/\D/g, '');
    setYear(val);
    if (birthdaySubmitAttempted) setBirthdaySubmitAttempted(false);
  };

  // Determine if we should show the birthday error
  // Show it if they attempted to submit, OR if they've typed something and there's an error 
  // (but don't yell at them for just starting to type the year)
  const shouldShowBirthdayError = birthdaySubmitAttempted || 
    (birthdayError && (day.length > 0 || month.length > 0 || year.length === 4 || (year.length > 0 && year.length < 4 && birthdaySubmitAttempted)));

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <AnimatePresence mode="wait">
        {subStep === 1 && (
          <motion.div 
            key="name"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            style={{ width: '100%' }}
          >
            <h2 className={styles.headline}>What's your full name?</h2>
            <p className={styles.subheadline}>We'd love to know what to call you.</p>
            <form onSubmit={handleNameSubmit}>
              <input
                type="text"
                autoFocus
                className={`${styles.largeInput} ${nameError ? styles.inputError : ''}`}
                placeholder="Alex River"
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
              />
              
              <div style={{ minHeight: '2rem', marginTop: '0.5rem' }}>
                {nameError ? (
                  <div className={styles.errorText}><AlertCircle size={16} /> {nameError}</div>
                ) : localName.trim() && localName.trim().length > 1 ? (
                  <div className={styles.successText}><Check size={16} /> Nice to meet you, {localName.trim().split(' ')[0]} ✨</div>
                ) : null}
              </div>

              <button 
                type="submit" 
                className={styles.continueBtn}
                disabled={!!nameError || localName.trim().length < 2}
              >
                Continue <ArrowRight className={styles.btnIcon} />
              </button>
            </form>
          </motion.div>
        )}

        {subStep === 2 && (
          <motion.div 
            key="username"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            style={{ width: '100%' }}
          >
            <h2 className={styles.headline}>Choose your username</h2>
            <p className={styles.subheadline}>This is how people will find you on Meetifyy.</p>
            <form onSubmit={handleUsernameSubmit}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', top: '8px', left: 0, fontSize: '2rem', color: '#6b7280' }}>@</span>
                <input
                  type="text"
                  autoFocus
                  className={`${styles.largeInput} ${usernameError ? styles.inputError : ''}`}
                  style={{ paddingLeft: '2.5rem' }}
                  placeholder="sarthak"
                  value={localUsername}
                  onChange={(e) => setLocalUsername(e.target.value.toLowerCase())}
                />
              </div>
              
              <div style={{ minHeight: '2rem', marginTop: '0.5rem' }}>
                {usernameError ? (
                  <div className={styles.errorText}><AlertCircle size={16} /> {usernameError}</div>
                ) : localUsername.length >= 3 ? (
                  <div className={styles.successText}><Check size={16} /> @{localUsername} is available!</div>
                ) : null}
              </div>

              <button 
                type="submit" 
                className={styles.continueBtn}
                disabled={!!usernameError || localUsername.trim().length < 3}
              >
                Continue <ArrowRight className={styles.btnIcon} />
              </button>
            </form>
          </motion.div>
        )}

        {subStep === 3 && (
          <motion.div 
            key="birthday"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            style={{ width: '100%' }}
          >
            <h2 className={styles.headline}>When's your birthday?</h2>
            <p className={styles.subheadline}>Just to make sure you're old enough to join.</p>
            <form onSubmit={handleBirthdaySubmit}>
              <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
                <input
                  type="text"
                  autoFocus
                  placeholder="DD"
                  maxLength={2}
                  className={`${styles.largeInput} ${shouldShowBirthdayError ? styles.inputError : ''}`}
                  style={{ width: '30%', textAlign: 'center' }}
                  value={day}
                  onChange={handleDayChange}
                />
                <input
                  type="text"
                  ref={monthRef}
                  placeholder="MM"
                  maxLength={2}
                  className={`${styles.largeInput} ${shouldShowBirthdayError ? styles.inputError : ''}`}
                  style={{ width: '30%', textAlign: 'center' }}
                  value={month}
                  onChange={handleMonthChange}
                />
                <input
                  type="text"
                  ref={yearRef}
                  placeholder="YYYY"
                  maxLength={4}
                  className={`${styles.largeInput} ${shouldShowBirthdayError ? styles.inputError : ''}`}
                  style={{ width: '40%', textAlign: 'center' }}
                  value={year}
                  onChange={handleYearChange}
                />
              </div>

              <div style={{ minHeight: '2rem', marginTop: '0.5rem' }}>
                {shouldShowBirthdayError && birthdayError && (
                  <div className={styles.errorText}><AlertCircle size={16} /> {birthdayError}</div>
                )}
              </div>

              <button 
                type="submit" 
                className={styles.continueBtn}
                // Do NOT disable this button so the user can click it and see validation errors
              >
                Continue <ArrowRight className={styles.btnIcon} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatedStep>
  );
}
