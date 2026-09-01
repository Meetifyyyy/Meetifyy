import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { CalendarClock, Loader2 } from '@shared/components/icons';
import styles from './DeletionScheduledNotice.module.css';

/** Seconds shown before the session is ended for the user. */
const LOGOUT_COUNTDOWN_SECONDS = 15;

/**
 * Shown once a deletion has actually been scheduled.
 *
 * The countdown is presentation only. The deletion is already persisted by the
 * time this mounts — that ordering matters, because otherwise closing the tab
 * mid-countdown would silently abandon a deletion the user believes they
 * completed. Nothing here can fail in a way that leaves the account in an
 * uncertain state; the worst case is that the user signs out by hand instead.
 */
export default function DeletionScheduledNotice({ scheduledPurgeAt, onLogout }) {
  const [remaining, setRemaining] = useState(LOGOUT_COUNTDOWN_SECONDS);
  // Guards against the interval and the button both firing a sign-out.
  const loggedOutRef = useRef(false);

  const finish = useRef(onLogout);
  finish.current = onLogout;

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          if (!loggedOutRef.current) {
            loggedOutRef.current = true;
            finish.current?.();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const formattedDate = useMemo(() => {
    if (!scheduledPurgeAt) return null;
    return new Date(scheduledPurgeAt).toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });
  }, [scheduledPurgeAt]);

  const signOutNow = () => {
    if (loggedOutRef.current) return;
    loggedOutRef.current = true;
    finish.current?.();
  };

  return (
    <div className={styles.backdrop} role="alertdialog" aria-modal="true">
      <div className={styles.card}>
        <div className={styles.iconBadge} aria-hidden="true">
          <CalendarClock size={26} />
        </div>

        <h2 className={styles.title}>Your account is scheduled for deletion</h2>

        <p className={styles.body}>
          Your account will be permanently deleted in 30 days. If you change
          your mind, simply log in again during this period to stop the deletion
          process.
        </p>

        {formattedDate && (
          <div className={styles.deadline}>
            <span className={styles.deadlineLabel}>Permanent deletion</span>
            <span className={styles.deadlineDate}>{formattedDate}</span>
          </div>
        )}

        <p className={styles.countdown} aria-live="polite">
          <Loader2 size={15} className="spin" aria-hidden="true" />
          <span>
            Signing you out in <strong>{remaining}</strong> second
            {remaining === 1 ? '' : 's'}…
          </span>
        </p>

        <button type="button" className={styles.primaryBtn} onClick={signOutNow}>
          Sign out now
        </button>
      </div>
    </div>
  );
}

DeletionScheduledNotice.propTypes = {
  /** Server-computed instant. Never derived on the client. */
  scheduledPurgeAt: PropTypes.string,
  onLogout: PropTypes.func.isRequired,
};
