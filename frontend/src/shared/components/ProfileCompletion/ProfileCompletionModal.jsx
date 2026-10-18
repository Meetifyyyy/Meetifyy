import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { GENDER_OPTIONS } from '@shared/constants/gender';
import { showToast } from '@shared/utils/toast';
import PersonalEmailForm from '@shared/components/AccountEmail/PersonalEmailForm';
import { isSignupInProgress } from '@features/auth/context/SignupContext';
import styles from './ProfileCompletionModal.module.css';

const DISMISS_PREFIX = 'meetifyy:profile-completion-later:';

function readDismissed(userId) {
  try {
    return sessionStorage.getItem(`${DISMISS_PREFIX}${userId}`) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(userId) {
  try {
    sessionStorage.setItem(`${DISMISS_PREFIX}${userId}`, '1');
  } catch {
    /* storage blocked: "Later" still closes it for this page's lifetime */
  }
}

/**
 * Asks a signed-in account for what newer signups give up front: a gender,
 * and a personal login email when the account still signs in with its college
 * address. Driven by the server's `profileCompletion` flags.
 *
 * Never blocks: "Later" closes it for the rest of the browser session, and it
 * does not open during signup (the signup flow collects gender itself).
 */
export default function ProfileCompletionModal() {
  const { currentUser, updateProfile, updateCurrentUser } = useAuth();
  const location = useLocation();
  const userId = currentUser?.id;
  const needsGender = Boolean(currentUser?.profileCompletion?.needsGender);
  const needsPersonalEmail = Boolean(currentUser?.profileCompletion?.needsPersonalEmail);

  const [dismissed, setDismissed] = useState(() => (userId ? readDismissed(userId) : false));
  const [gender, setGender] = useState('');
  const [savingGender, setSavingGender] = useState(false);

  useEffect(() => {
    if (userId) setDismissed(readDismissed(userId));
  }, [userId]);

  const inSignup = location.pathname.startsWith('/signup') || isSignupInProgress();
  const open = Boolean(userId) && !dismissed && !inSignup && (needsGender || needsPersonalEmail);

  useScrollLock(open);

  const later = useCallback(() => {
    if (userId) writeDismissed(userId);
    setDismissed(true);
  }, [userId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') later();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, later]);

  if (!open) return null;

  const steps = [needsGender && 'gender', needsPersonalEmail && 'email'].filter(Boolean);
  const step = steps[0];
  const stepLabel = steps.length > 1 ? `Step 1 of ${steps.length}` : 'One more thing';

  const saveGender = async () => {
    if (!gender || savingGender) return;
    setSavingGender(true);
    try {
      await updateProfile({ gender });
      // `updateProfile` merges what it sent; the flag is the server's, so
      // clear it locally rather than wait for the next session read.
      updateCurrentUser({
        ...currentUser,
        gender,
        profileCompletion: { ...currentUser.profileCompletion, needsGender: false },
      });
    } catch (err) {
      showToast(err?.message || "Couldn't save that. Try again.", 'error');
    } finally {
      setSavingGender(false);
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="profile-completion-title">
      <div className={styles.dialog}>
        <p className={styles.step}>{stepLabel}</p>
        {step === 'gender' ? (
          <>
            <h2 id="profile-completion-title" className={styles.title}>
              How do you identify?
            </h2>
            <p className={styles.lead}>Add your gender to finish your profile.</p>
            <div className={styles.options} role="radiogroup" aria-label="Gender">
              {GENDER_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={gender === o.value}
                  className={`${styles.option} ${gender === o.value ? styles.optionActive : ''}`}
                  onClick={() => setGender(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryBtn} onClick={saveGender} disabled={!gender || savingGender}>
                {savingGender ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="profile-completion-title" className={styles.title}>
              Add a personal email
            </h2>
            <p className={styles.lead}>
              You sign in with your college email. Add a personal one so you keep your account after
              you graduate.
            </p>
            <PersonalEmailForm
              submitLabel="Add personal email"
              onDone={(email) => {
                showToast(email ? `You now sign in with ${email}` : 'Email updated', 'success');
              }}
            />
          </>
        )}
        <button type="button" className={styles.later} onClick={later}>
          Later
        </button>
      </div>
    </div>
  );
}
