import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { GENDER_OPTIONS } from '@shared/constants/gender';
import { showToast } from '@shared/utils/toast';
import { usersApi } from '@shared/api/apiClient';
import PersonalEmailForm from '@shared/components/AccountEmail/PersonalEmailForm';
import { useOnlineStatus } from '@shared/lib/networkStatus';
import { isSignupInProgress } from '@features/auth/context/SignupContext';
import styles from './ProfileCompletionModal.module.css';

const DISMISS_PREFIX = 'meetifyy:profile-completion-later:';
const SNOOZE_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * "Later" is remembered in localStorage with its time, per account, so it
 * survives closing the tab or the app and lapses after 10 days. A new browser
 * or device has no entry, so it asks again there. (sessionStorage, used
 * before, forgot it the moment the tab closed; the server-side snooze only
 * holds while the session id is unchanged, which a reopen does not guarantee.)
 */
function readDismissed(userId) {
  try {
    const at = Number(localStorage.getItem(`${DISMISS_PREFIX}${userId}`));
    if (!Number.isFinite(at) || at <= 0) return false;
    const age = Date.now() - at;
    return age >= 0 && age < SNOOZE_MS;
  } catch {
    return false;
  }
}

function writeDismissed(userId) {
  try {
    localStorage.setItem(`${DISMISS_PREFIX}${userId}`, String(Date.now()));
  } catch {
    /* storage blocked: "Later" still closes it for this page's lifetime */
  }
}

/**
 * Asks a signed-in account for what newer signups give up front: a gender,
 * and a personal login email when the account still signs in with its college
 * address. Driven by the server's `profileCompletion` flags.
 *
 * Never blocks. "Later" asks the server to snooze it (`promptSnoozed`: until 10
 * days pass or the account signs in again, on any device), and also remembers
 * it in localStorage for 10 days on this browser, so it stays closed across
 * reopens even if that call fails or the backend predates `promptSnoozed`. It does not open during signup (the
 * signup flow collects gender itself).
 *
 * It opens only on the server's confirmed answer: never offline and never from
 * the profile this device saved earlier (see `serverConfirmed`).
 */
export default function ProfileCompletionModal() {
  const { currentUser, updateProfile, updateCurrentUser, profileFromCache, loading } = useAuth();
  const online = useOnlineStatus();
  const location = useLocation();
  const userId = currentUser?.id;
  const needsGender = Boolean(currentUser?.profileCompletion?.needsGender);
  const needsPersonalEmail = Boolean(currentUser?.profileCompletion?.needsPersonalEmail);
  const snoozed = Boolean(currentUser?.profileCompletion?.promptSnoozed);

  const [dismissed, setDismissed] = useState(() => (userId ? readDismissed(userId) : false));
  const [gender, setGender] = useState('');
  const [savingGender, setSavingGender] = useState(false);

  useEffect(() => {
    if (userId) setDismissed(readDismissed(userId));
  }, [userId]);

  const inSignup = location.pathname.startsWith('/signup') || isSignupInProgress();
  // The flags are the SERVER's answer, so they only count once the server has
  // given them to this session. Not while offline, not while `currentUser` is
  // the copy this device saved last time (`profileFromCache`, or still booting),
  // and not from a failed request: a saved copy can be days old, or from before
  // the person answered on another device, and asking again from it is wrong.
  // When the connection or the server's answer returns, the flags are fresh and
  // this opens then.
  const serverConfirmed = online && !profileFromCache && !loading;
  const open =
    Boolean(userId) && serverConfirmed && !dismissed && !snoozed && !inSignup && (needsGender || needsPersonalEmail);

  useScrollLock(open);

  const later = useCallback(() => {
    if (userId) writeDismissed(userId);
    setDismissed(true);
    // Optimistic: closed now, whatever the server says. A failed call (offline,
    // older backend) leaves the sessionStorage hide above to keep it closed.
    if (currentUser?.profileCompletion) {
      updateCurrentUser({
        ...currentUser,
        profileCompletion: { ...currentUser.profileCompletion, promptSnoozed: true },
      });
    }
    try {
      Promise.resolve(usersApi.snoozeProfilePrompt()).catch(() => {
        /* fallback above applies */
      });
    } catch {
      /* fallback above applies */
    }
  }, [userId, currentUser, updateCurrentUser]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') later();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, later]);

  const steps = [needsGender && 'gender', needsPersonalEmail && 'email'].filter(Boolean);
  // Remembered from when the modal opened: once gender is saved `steps` shrinks
  // to one, and the dots must still read "second of two".
  const totalStepsRef = useRef(0);
  totalStepsRef.current = Math.max(totalStepsRef.current, steps.length);

  if (!open) return null;

  const step = steps[0];
  const totalSteps = totalStepsRef.current;
  const stepIndex = totalSteps - steps.length;

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
    // data-profile-prompt: the cookie banner hides while this is open (it is
    // fixed to the bottom above every dialog and covered Save/Later on short
    // phones); see CookieBanner.module.css.
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-completion-title"
      data-profile-prompt=""
    >
      <div className={styles.dialog}>
        {totalSteps > 1 ? (
          <div className={styles.dots} role="img" aria-label={`Step ${stepIndex + 1} of ${totalSteps}`}>
            {Array.from({ length: totalSteps }, (_, i) => (
              <span key={i} className={`${styles.dot} ${i === stepIndex ? styles.dotActive : ''}`} />
            ))}
          </div>
        ) : null}
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
              <button type="button" className={styles.secondaryBtn} onClick={later}>
                Later
              </button>
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
              onCancel={later}
              cancelLabel="Later"
              alignActionsEnd
              onDone={(email) => {
                showToast(email ? `You now sign in with ${email}` : 'Email updated', 'success');
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
