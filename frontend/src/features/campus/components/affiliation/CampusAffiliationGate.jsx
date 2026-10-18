import { Link } from 'react-router-dom';
import { GraduationCap } from '@shared/components/icons';
import { useCampusAffiliation } from '@shared/hooks/useCampusAffiliation';
import styles from './CampusAffiliation.module.css';

/**
 * Wraps a Campus sub-page (directory, communities, events). With a verified
 * college email it renders the page; without one it explains and sends the
 * person to /campus, where the verification flow lives. While the answer is
 * still unknown (an older API being asked) it renders nothing rather than a
 * flash of the wrong screen.
 */
export default function CampusAffiliationGate({ children }) {
  const { status } = useCampusAffiliation();
  if (status === 'active') return children;
  if (status === 'loading') return null;
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>
          <GraduationCap size={14} aria-hidden="true" /> Campus
        </p>
        <h1 className={styles.title}>Verify your college email</h1>
        <p className={styles.lead}>
          Campus is only for students of the same college. Confirm your college email once to see
          your campus directory, events and communities.
        </p>
        <div className={styles.actions}>
          <Link to="/campus" className={styles.primaryBtn}>
            Verify college email
          </Link>
        </div>
      </div>
    </div>
  );
}
