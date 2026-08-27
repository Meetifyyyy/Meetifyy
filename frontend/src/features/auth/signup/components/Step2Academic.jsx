import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, AlertCircle } from '@shared/components/icons';
import { useSignup } from '../../context/SignupContext';
import AnimatedStep from './AnimatedStep';
import CustomSelect from './CustomSelect';
import AcademicSelection from '@shared/academics/AcademicSelection';
import { useAcademicCatalog } from '@shared/academics/useAcademicCatalog';
import { useColleges } from '@shared/academics/useColleges';
import { validateAcademicSelection, ACADEMIC_ERRORS } from '@shared/academics/academicCatalog';
import { apiClient } from '@shared/api/apiClient';
import { useAvailabilityCheck } from '../hooks/useAvailabilityCheck';
import { AuthHeading, AuthField, AuthButton, styles as s } from '../../shared/ui';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Step2Academic() {
  const navigate = useNavigate();
  const { signupData, updateData, nextStep } = useSignup();

  const { colleges, loading: loadingColleges } = useColleges();
  const [collegeId, setCollegeId] = useState(signupData.collegeId || '');
  const [email, setEmail] = useState(signupData.email || '');

  // One controlled object rather than three loose fields, so course/branch/year
  // can never drift out of sync with each other.
  const [academic, setAcademic] = useState(() => ({
    course: signupData.course || '',
    branch: signupData.branch || '',
    passingYear: Number.isInteger(signupData.passingYear ?? signupData.currentYear)
      ? (signupData.passingYear ?? signupData.currentYear)
      : null,
  }));
  const [attempted, setAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hardBlockReason, setHardBlockReason] = useState('');

  const selectedCollege = useMemo(() => {
    return colleges.find((c) => c.id === collegeId) || null;
  }, [colleges, collegeId]);

  const collegeError = useMemo(() => {
    if (!collegeId) return 'Please select your college or university.';
    return null;
  }, [collegeId]);

  const emailFormatError = useMemo(() => {
    if (!email) return 'College email is required.';
    if (!email.includes('@')) return 'Enter a valid email address.';
    if (!emailRegex.test(email)) return 'Please enter a valid email address.';

    if (!collegeId || !selectedCollege) {
      return 'Please select your college first.';
    }

    const domain = email.split('@')[1]?.toLowerCase().trim() || '';
    if (!domain) return 'Please enter a valid email address.';

    const collegeDisplayName = selectedCollege.shortName || selectedCollege.name;
    const approvedDomains = (selectedCollege.domains || []).map((d) => d.toLowerCase().trim());

    // Validate domain against the college's approved domains configured from admin portal
    if (approvedDomains.length > 0 && !approvedDomains.includes(domain)) {
      return `Please use your official ${collegeDisplayName} email.`;
    }

    return null;
  }, [email, collegeId, selectedCollege]);

  const normalizedEmail = email.trim().toLowerCase();
  const availabilityExtraBody = useMemo(() => (collegeId ? { collegeId } : undefined), [collegeId]);

  const { status: rawEmailStatus, reason: emailReason } = useAvailabilityCheck(normalizedEmail, {
    endpoint: '/api/auth/check-email',
    field: 'email',
    extraBody: availabilityExtraBody,
    enabled: !emailFormatError && !!collegeId,
  });
  const emailStatus = rawEmailStatus === 'network-error' ? 'network' : rawEmailStatus;

  const { courses: academicCourses } = useAcademicCatalog();

  // Per-field messages, derived from the one shared rule set so signup and
  // settings can never disagree about what is valid.
  const academicErrors = useMemo(() => ({
    course: !academic.course ? ACADEMIC_ERRORS.COURSE_REQUIRED : null,
    branch: !academic.branch ? ACADEMIC_ERRORS.BRANCH_REQUIRED : null,
    passingYear:
      !Number.isInteger(academic.passingYear) ? ACADEMIC_ERRORS.YEAR_REQUIRED : null,
  }), [academic]);

  const academicError = useMemo(
    () => validateAcademicSelection(academicCourses, academic),
    [academicCourses, academic],
  );

  const isChecking = emailStatus === 'checking';

  const emailError =
    emailStatus === 'taken'
      ? emailReason || 'This email is already registered. Please sign in.'
      : (attempted || email.includes('@')) && emailFormatError
        ? emailFormatError
        : hardBlockReason || null;
  const emailHint =
    emailStatus === 'network' ? "Couldn't verify — you can still continue." : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAttempted(true);
    setHardBlockReason('');

    if (collegeError || emailFormatError || academicError) return;
    if (emailStatus === 'taken') return;

    // If the live check hasn't confirmed 'available' yet, run one authoritative
    // blocking check before advancing.
    if (emailStatus !== 'available') {
      setIsSubmitting(true);
      try {
        const res = await apiClient.post('/api/auth/check-email', {
          email: normalizedEmail,
          collegeId,
        });
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

    const universityName = selectedCollege?.name || selectedCollege?.shortName || 'University';

    // Persist the exact ids the backend validates against — no display strings,
    // and no `year`/`major` legacy keys.
    updateData({
      collegeId,
      collegeName: selectedCollege?.name || '',
      university: universityName,
      email: normalizedEmail,
      course: academic.course,
      branch: academic.branch,
      passingYear: academic.passingYear,
    });
    nextStep();
  };

  return (
    <AnimatedStep className={s.stepWrapper}>
      <AuthHeading title="Academic details" />

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        {/* College / University Searchable Selection */}
        <div className={`${s.selectGroup} ${attempted && collegeError ? s.isInvalid : ''}`}>
          <label className={s.selectLabel}>College / University</label>
          <CustomSelect
            value={collegeId}
            onChange={(val) => {
              setCollegeId(val);
              if (hardBlockReason) setHardBlockReason('');
            }}
            placeholder={loadingColleges ? 'Loading colleges...' : 'Select College / University'}
            isInvalid={attempted && !!collegeError}
            searchable={false}
            options={colleges.map((c) => ({
              value: c.id,
              label: c.name,
            }))}
            footerAction={{
              label: "Can't find your college? Request to add it →",
              onClick: () => {
                navigate('/?request=college#join');
              },
            }}
          />
          <div className={s.messageSlot}>
            {attempted && collegeError ? (
              <div className={`${s.message} ${s.messageError}`} role="alert">
                <AlertCircle size={13} /> {collegeError}
              </div>
            ) : null}
          </div>
        </div>

        {/* College Email Field */}
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

        {/* Course, Branch, and Current Year Selection */}
        <AcademicSelection
          value={academic}
          onChange={setAcademic}
          Select={CustomSelect}
          errors={academicErrors}
          showErrors={attempted}
          classes={{
            selectGroup: s.selectGroup,
            selectLabel: s.selectLabel,
            messageSlot: s.messageSlot,
            message: s.message,
            messageError: s.messageError,
          }}
        />

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
