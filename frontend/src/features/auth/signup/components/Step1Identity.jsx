import React, { useState, useMemo, useEffect } from 'react';
import { AlertCircle, ArrowRight } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import CustomSelect from './CustomSelect';
import { validateDOB } from '../../../../shared/utils/dateValidation';
import { useAvailabilityCheck } from '../hooks/useAvailabilityCheck';
import { AuthHeading, AuthField, AuthButton, styles as s } from '../../shared/ui';

export default function Step1Identity() {
  const { signupData, updateData, nextStep } = useSignup();

  const [name, setName] = useState(
    signupData.firstName ? `${signupData.firstName} ${signupData.lastName || ''}`.trim() : '',
  );
  const [username, setUsername] = useState(signupData.username || '');

  const initialDob = signupData.birthday || '';
  const initialParts = initialDob ? initialDob.split('-') : ['', '', ''];
  const initialYear = initialParts[0] || '';
  const initialMonth = initialParts[1] ? String(parseInt(initialParts[1], 10)) : '';
  const initialDay = initialParts[2] ? String(parseInt(initialParts[2], 10)) : '';
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [day, setDay] = useState(initialDay);
  const [attempted, setAttempted] = useState(false);

  // ── Validation ────────────────────────────────────────────────────────────
  const nameError = useMemo(() => {
    if (!name) return 'Name is required.';
    if (/\d/.test(name)) return 'Names cannot contain numbers.';
    if (/[!@#$%^&*(),.?":{}|<>]/.test(name)) return 'Names cannot contain special characters.';
    if (name.trim().length < 2) return 'Please enter a valid name.';
    if (name.trim().length > 30) return 'Name cannot exceed 30 characters.';
    return null;
  }, [name]);

  const usernameFormatError = useMemo(() => {
    if (!username) return 'Username is required.';
    if (username.includes(' ')) return 'Usernames cannot contain spaces.';
    if (/[^a-z0-9_.]/.test(username)) return 'Use lowercase letters, numbers, _ or .';
    if (username.length < 3) return 'At least 3 characters.';
    if (username.length > 30) return 'Username cannot exceed 30 characters.';
    return null;
  }, [username]);

  const normalizedUsername = username.trim().toLowerCase();
  const { status: rawUsernameStatus } = useAvailabilityCheck(normalizedUsername, {
    endpoint: '/api/auth/check-username',
    field: 'username',
    enabled: !usernameFormatError && normalizedUsername.length >= 3,
  });
  const usernameStatus = rawUsernameStatus === 'network-error' ? 'network' : rawUsernameStatus;

  const dobValidation = useMemo(() => validateDOB(year, month, day), [year, month, day]);
  const dobError = dobValidation.error;

  const isChecking = usernameStatus === 'checking';
  const isUsernameBlocked = !!usernameFormatError || usernameStatus === 'taken';
  const isValid = !nameError && !isUsernameBlocked && !dobError && !isChecking;

  const handleSubmit = (e) => {
    e.preventDefault();
    setAttempted(true);
    if (isChecking) return;
    if (isValid) {
      const parts = name.trim().split(' ');
      updateData({
        firstName: parts[0],
        lastName: parts.slice(1).join(' '),
        username: normalizedUsername,
        birthday: dobValidation.dobString,
      });
      nextStep();
    }
  };

  const usernameError =
    attempted && usernameFormatError
      ? usernameFormatError
      : usernameStatus === 'taken'
        ? 'Username not available'
        : null;
  const usernameHint =
    usernameStatus === 'network'
      ? "Couldn't verify availability — you can still continue."
      : null;

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="Tell us about yourself" />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <AuthField
          id="signup-name"
          label="Full Name"
          type="text"
          maxLength={30}
          value={name}
          error={attempted ? nameError : null}
          onChange={(e) => setName(e.target.value.slice(0, 30))}
        />

        <AuthField
          id="signup-username"
          label="Username"
          type="text"
          maxLength={30}
          value={username}
          status={usernameStatus}
          error={usernameError}
          hint={usernameHint}
          onChange={(e) => {
            const val = e.target.value.toLowerCase().slice(0, 30);
            if (val !== '' && /[^a-z0-9_.]/.test(val)) return;
            setUsername(val);
          }}
        />

        <div className={`${s.selectGroup} ${attempted && dobError ? s.isInvalid : ''}`}>
          <span className={s.selectLabel}>Birthday</span>
          <div className={s.selectRow}>
            <CustomSelect
              value={month}
              onChange={setMonth}
              placeholder="Month"
              isInvalid={attempted && !!dobError}
              options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
                value: m,
                label: new Date(0, m - 1).toLocaleString('default', { month: 'short' }),
              }))}
            />
            <input
              id="signup-dob-day"
              type="text"
              inputMode="numeric"
              maxLength={2}
              className={`${s.input} ${attempted && dobError ? s.invalid : ''}`}
              placeholder="Day"
              value={day}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
                if (raw === '') {
                  setDay('');
                  return;
                }
                const num = parseInt(raw, 10);
                if (num > 31) {
                  return;
                }
                setDay(raw);
              }}
              aria-label="Day"
            />
            <input
              id="signup-dob-year"
              type="text"
              inputMode="numeric"
              maxLength={4}
              className={`${s.input} ${attempted && dobError ? s.invalid : ''}`}
              placeholder="Year"
              value={year}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                setYear(val);
              }}
              aria-label="Year"
            />
          </div>
          <div className={s.messageSlot}>
            {attempted && dobError ? (
              <div className={`${s.message} ${s.messageError}`} role="alert">
                <AlertCircle size={13} /> {dobError}
              </div>
            ) : null}
          </div>
        </div>

        <AuthButton
          type="submit"
          loading={isChecking}
          loadingText="Checking..."
          icon={<ArrowRight size={18} />}
          style={{ marginTop: '0.5rem' }}
        >
          Continue
        </AuthButton>
      </form>
    </AnimatedStep>
  );
}
