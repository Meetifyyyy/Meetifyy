import { useEffect, useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { pushApi } from '@shared/api/apiClient';
import { enablePush, getPushStatus } from './pushRegistration';
import styles from './PushOptInCard.module.css';

const DISMISSED_KEY = 'meetifyy:push-optin-dismissed';

function dismissedBefore() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Private mode: it may show again next visit, which is the only cost.
  }
}

/**
 * The contextual push opt-in, shown on the Notifications page only.
 *
 * Never on page load of the app, and never the OS prompt by itself: the
 * browser/OS dialog opens only when "Turn on" is pressed. Shown once per
 * device, only when the permission has not been decided yet, push is offered
 * here, and the account has not already turned it on. "Not now" is
 * remembered; a denial is the OS's own state and is never re-asked.
 */
export default function PushOptInCard() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId || dismissedBefore()) return undefined;
    let cancelled = false;
    (async () => {
      const status = await getPushStatus().catch(() => null);
      if (!status?.available || status.permission !== 'prompt') return;
      const prefs = await pushApi.getPreferences().catch(() => null);
      if (!cancelled && prefs && !prefs.enabled) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!visible) return null;

  const turnOn = async () => {
    setBusy(true);
    await enablePush({ userId }).catch(() => 'denied');
    rememberDismissed();
    setVisible(false);
  };

  const notNow = () => {
    rememberDismissed();
    setVisible(false);
  };

  return (
    <section className={styles.card} aria-label="Push notifications">
      <div className={styles.text}>
        <p className={styles.title}>Know when it happens</p>
        <p className={styles.body}>
          Get a notification for messages, replies and invites, even when Meetifyy is closed.
          You can choose which ones in Settings.
        </p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={notNow} disabled={busy}>
          Not now
        </button>
        <button type="button" className={styles.primary} onClick={turnOn} disabled={busy}>
          Turn on
        </button>
      </div>
    </section>
  );
}
