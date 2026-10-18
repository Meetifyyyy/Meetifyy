import { useEffect, useState } from 'react';
import CollegePicker from './CollegePicker';
import CollegeEmailVerify from './CollegeEmailVerify';
import styles from './CampusAffiliation.module.css';

/**
 * What Campus shows to someone without a verified college email: pick a
 * college, then verify its email. A code already sent (before a reload or an
 * app restart) comes back from the server as `pending` and resumes on the code
 * step; nothing about it is kept on the device.
 *
 * `pending` / `pendingLoading` come from `useCampusAffiliation({ withPending })`
 * in the page, so the page and this flow read one query.
 */
export default function CampusJoinFlow({ pending = null, pendingLoading = false, onVerified, onCancel }) {
  const [college, setCollege] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [restored, setRestored] = useState(false);

  // Resume a pending code once, when the server's answer first arrives. Later
  // changes to `pending` (a resend from this screen) are the flow's own doing.
  useEffect(() => {
    if (restored || pendingLoading) return;
    setRestored(true);
    if (pending?.collegeId && !college) {
      setCollege({ id: pending.collegeId, name: pending.collegeName || 'Your college', logoUrl: pending.logoUrl });
      setChallenge({
        emailMasked: pending.emailMasked,
        expiresAt: pending.expiresAt,
        resendAvailableAt: pending.resendAvailableAt,
      });
    }
  }, [pending, pendingLoading, restored, college]);

  if (pendingLoading && !restored) {
    return (
      <div className={styles.wrap} aria-busy="true">
        <div className={styles.card}>
          <div className={styles.skeletonCard} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {college ? (
        <CollegeEmailVerify
          key={college.id}
          college={college}
          initialChallenge={challenge}
          onChangeCollege={() => {
            setCollege(null);
            setChallenge(null);
          }}
          onVerified={onVerified}
        />
      ) : (
        <CollegePicker
          onSelect={(c) => {
            setChallenge(null);
            setCollege(c);
          }}
        />
      )}
      {onCancel ? (
        <p className={styles.note} style={{ textAlign: 'center' }}>
          <button type="button" className={styles.linkBtn} onClick={onCancel}>
            Keep my current college email
          </button>
        </p>
      ) : null}
    </div>
  );
}
