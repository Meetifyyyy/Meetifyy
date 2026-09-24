import { useState, useMemo } from 'react';
import { AlertCircle, ArrowRight } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import CustomSelect from './CustomSelect';
import { validateDOB } from '../../../../shared/utils/dateValidation';
import { useAvailabilityCheck } from '../hooks/useAvailabilityCheck';
import { AuthHeading, AuthField, AuthButton, styles as s } from '../../shared/ui';

/**
 * Step 2 — username and birthday: the two things that make up the person's
 * public identity on Meetifyy. The username is checked as they type, so the
 * answer is usually there before they reach the birthday.
 */
export default function Step2Profile() {
  const { signupData, updateData, nextStep } = useSignup();

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
  const usernameFormatError = useMemo(() => {
    if (!username) return 'Username is required.';
    if (username.includes(' ')) return 'Usernames cannot contain spaces.';
    if (/[^a-z0-9_.]/.test(username)) return 'Use lowercase letters, numbers, _ or .';
    if (username.length < 3) return 'At least 3 characters.';
    if (username.length > 30) return 'Username cannot exceed 30 characters.';
    return null;
  }, [username]);

  const normalizedUsername = username.trim().toLowerCase();
  const { status: usernameStatus, reason: usernameReason } = useAvailabilityCheck(normalizedUsername, {
    endpoint: '/api/auth/check-username',
    field: 'username',
    enabled: !usernameFormatError && normalizedUsername.length >= 3,
  });

  const dobValidation = useMemo(() => validateDOB(year, month, day), [year, month, day]);
  const dobError = dobValidation.error;

  const isChecking = usernameStatus === 'checking';
  /**
   * Anything other than a confirmed 'available' blocks.
   *
   * This used to block only on 'taken', so a check that failed for technical
   * reasons left the step passable and the field showed "couldn't verify
   * availability, you can still continue". The username is unique-constrained
   * at signup, so continuing meant walking the user through three more steps
   * before failing on something we could have told them here.
   */
  const isUsernameBlocked =
    !!usernameFormatError || (usernameStatus !== null && usernameStatus !== 'available');
  const isValid = !isUsernameBlocked && !dobError && !isChecking;

  const handleSubmit = (e) => {
    e.preventDefault();
    setAttempted(true);
    if (isChecking) return;
    if (isValid) {
      updateData({
        username: normalizedUsername,
        birthday: dobValidation.dobString,
      });
      nextStep();
    }
  };

  const usernameError = (() => {
    if (attempted && usernameFormatError) return usernameFormatError;
    if (usernameFormatError) return null;
    if (usernameStatus === 'rejected') return usernameReason || 'Username not available.';
    if (usernameStatus === 'invalid') return 'Please choose a valid username.';
    if (usernameStatus === 'error') {
      return "We couldn't check that username right now. Please check your connection and try again.";
    }
    return null;
  })();
  // Never "continue anyway": an unchecked username is not an available one.
  const usernameHint =
    usernameStatus === 'available' ? `@${normalizedUsername} is available` : 'Lowercase letters, numbers, _ and .';

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading
        title={signupData.firstName ? `Nice to meet you, ${signupData.firstName}` : 'Your profile'}
        subtitle="Pick a username and add your birthday. Your username is how other students find you."
      />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <AuthField
          id="signup-username"
          label="Username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
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
          <span className={s.selectLabel} id="signup-dob-label">Birthday</span>
          <div className={s.selectRow} role="group" aria-labelledby="signup-dob-label">
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
                <AlertCircle size={14} aria-hidden="true" />
                <span>{dobError}</span>
              </div>
            ) : null}
          </div>
        </div>

        <AuthButton
          type="submit"
          loading={isChecking}
          loadingText="Checking..."
          icon={<ArrowRight size={18} />}
          className={s.primaryAction}
        >
          Continue
        </AuthButton>
      </form>
    </AnimatedStep>
  );
}
