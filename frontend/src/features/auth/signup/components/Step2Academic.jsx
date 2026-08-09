import React, { useState, useMemo } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import CustomSelect from './CustomSelect';
import { MAJORS_LIST } from '../../../campus/data/majors';
import { apiClient } from '@shared/api/apiClient';
import { useAvailabilityCheck } from '../hooks/useAvailabilityCheck';
import { AuthHeading, AuthField, AuthButton, styles as s } from '../../shared/ui';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Step2Academic() {
  const { signupData, updateData, nextStep } = useSignup();

  const [email, setEmail] = useState(signupData.email || '');
  const [major, setMajor] = useState(signupData.course || signupData.branch || '');
  const [year, setYear] = useState(signupData.year || '');
  const [attempted, setAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hardBlockReason, setHardBlockReason] = useState('');

  const emailFormatError = useMemo(() => {
    if (!email) return 'College email is required.';
    if (!email.includes('@')) return 'Enter a valid email address.';
    if (!emailRegex.test(email)) return 'Please enter a valid email address.';
    const domain = email.split('@')[1] || '';
    if (!domain.endsWith('.edu') && !domain.endsWith('.ac.in') && !domain.endsWith('.org') && !domain.endsWith('.com')) {
      return 'Please enter a valid institution email.';
    }
    return null;
  }, [email]);

  const normalizedEmail = email.trim().toLowerCase();
  const { status: rawEmailStatus, reason: emailReason } = useAvailabilityCheck(normalizedEmail, {
    endpoint: '/api/auth/check-email',
    field: 'email',
    enabled: !emailFormatError,
  });
  const emailStatus = rawEmailStatus === 'network-error' ? 'network' : rawEmailStatus;

  const currentYear = new Date().getFullYear();
  const maxPassingYear = currentYear + 6;
  const years = useMemo(() => {
    const list = [];
    for (let y = 2026; y <= maxPassingYear; y++) list.push(String(y));
    return list;
  }, [maxPassingYear]);

  const majorError = !major.trim() ? 'Major / Course is required.' : null;
  const yearError = useMemo(() => {
    if (!year) return 'Year is required.';
    const num = parseInt(year, 10);
    if (isNaN(num) || num < 2026 || num > maxPassingYear) return `Must be 2026–${maxPassingYear}.`;
    return null;
  }, [year, maxPassingYear]);

  const isChecking = emailStatus === 'checking';

  const emailError =
    attempted && emailFormatError
      ? emailFormatError
      : emailStatus === 'taken'
        ? emailReason || 'This email is already registered. Please sign in.'
        : hardBlockReason || null;
  const emailHint =
    emailStatus === 'network' ? "Couldn't verify — you can still continue." : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);
    setHardBlockReason('');

    if (emailFormatError || majorError || yearError) return;
    if (emailStatus === 'taken') return;

    // If the live check hasn't confirmed 'available' yet, run one authoritative
    // blocking check before advancing.
    if (emailStatus !== 'available') {
      setIsSubmitting(true);
      try {
        const res = await apiClient.post('/api/auth/check-email', { email: normalizedEmail });
        if (res?.available === false) {
          setHardBlockReason(res?.reason || 'This email is already registered. Please sign in.');
          setIsSubmitting(false);
          return;
        }
      } catch {
        // Network still down — proceed; the backend enforces conflicts at signup.
      }
      setIsSubmitting(false);
    }

    let university = 'University';
    const domain = normalizedEmail.split('@')[1] || '';
    const domainPart = domain.split('.')[0];
    if (domainPart) university = domainPart.charAt(0).toUpperCase() + domainPart.slice(1) + ' University';

    updateData({ email: normalizedEmail, course: major, branch: major, year, university });
    nextStep();
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="Academic details" subtitle="Connect with peers at your institution." />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <AuthField
          id="signup-email"
          label="College Email"
          type="email"
          value={email}
          status={emailStatus}
          error={emailError}
          hint={emailHint}
          onChange={(e) => {
            setEmail(e.target.value);
            if (hardBlockReason) setHardBlockReason('');
          }}
        />

        <div className={s.fieldRow}>
          <div className={s.fieldRowMain}>
            <div className={s.selectGroup}>
              <span className={s.selectLabel}>Major / Course</span>
              <CustomSelect
                value={major}
                onChange={setMajor}
                placeholder="Select Major"
                options={MAJORS_LIST}
                searchable
              />
            </div>
            <div className={s.messageSlot}>
              {attempted && majorError ? (
                <div className={`${s.message} ${s.messageError}`}>
                  <AlertCircle size={13} /> {majorError}
                </div>
              ) : null}
            </div>
          </div>

          <div className={s.fieldRowSide}>
            <div className={s.selectGroup}>
              <span className={s.selectLabel}>Year of Passing</span>
              <CustomSelect
                value={year}
                onChange={setYear}
                placeholder="Year"
                options={years.map((y) => ({ value: y, label: y }))}
                searchable
              />
            </div>
            <div className={s.messageSlot}>
              {attempted && yearError ? (
                <div className={`${s.message} ${s.messageError}`}>
                  <AlertCircle size={13} /> {yearError}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <AuthButton
          type="submit"
          loading={isChecking || isSubmitting}
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
