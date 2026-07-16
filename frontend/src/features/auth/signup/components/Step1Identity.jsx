import React, { useState, useMemo } from 'react';
import { useSignup } from '../SignupContext';
import AnimatedStep from './AnimatedStep';
import { ArrowRight, Check, AlertCircle } from 'lucide-react';
import styles from '../SignupFlow.module.css';
import { initialUsers } from '@data/mockData';

export default function Step1Identity() {
  const { signupData, updateData, nextStep } = useSignup();
  
  const [name, setName] = useState(signupData.firstName ? `${signupData.firstName} ${signupData.lastName || ''}`.trim() : '');
  const [username, setUsername] = useState(signupData.username || '');
  const [dob, setDob] = useState(signupData.birthday || '');
  const [attempted, setAttempted] = useState(false);

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
  const dobError = useMemo(() => {
    if (!dob) return "Date of birth is required.";
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) return "Please enter a valid date.";
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const mDiff = today.getMonth() - birthDate.getMonth();
    if (mDiff < 0 || (mDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    if (age < 18) return "You must be at least 18 years old to join.";
    if (age > 120) return "Please enter a valid date of birth.";
    return null;
  }, [dob]);

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
        birthday: dob
      });
      nextStep();
    }
  };

  return (
    <AnimatedStep className={styles.stepWrapper}>
      <h2 className={styles.headline}>Tell us about yourself</h2>
      <p className={styles.subheadline}>Let's start with the basics to set up your profile.</p>
      
      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Full Name</label>
          <input
            type="text"
            className={`${styles.largeInput} ${attempted && nameError ? styles.inputError : ''}`}
            placeholder="Alex River"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ fontSize: '1.35rem', padding: '0.35rem 0', margin: '0.25rem 0 0 0' }}
          />
          {attempted && nameError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={14} /> {nameError}</div>
          )}
        </div>

        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Username</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', top: '7px', left: 0, fontSize: '1.35rem', color: '#6b7280' }}>@</span>
            <input
              type="text"
              className={`${styles.largeInput} ${attempted && usernameError ? styles.inputError : ''}`}
              style={{ fontSize: '1.35rem', padding: '0.35rem 0 0.35rem 1.25rem', margin: '0.25rem 0 0 0' }}
              placeholder="alexriver"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
            />
          </div>
          {attempted && usernameError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={14} /> {usernameError}</div>
          )}
        </div>

        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Date of Birth</label>
          <input
            type="date"
            className={`${styles.largeInput} ${attempted && dobError ? styles.inputError : ''}`}
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            style={{ fontSize: '1.35rem', padding: '0.35rem 0', margin: '0.25rem 0 0 0', display: 'block', color: dob ? 'var(--color-text-main)' : 'var(--color-text-light)' }}
          />
          {attempted && dobError && (
            <div className={styles.errorText} style={{ marginTop: '0.25rem' }}><AlertCircle size={14} /> {dobError}</div>
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
