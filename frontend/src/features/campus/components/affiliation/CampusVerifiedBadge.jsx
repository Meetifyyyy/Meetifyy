import { CheckCircle2 } from '@shared/components/icons';
import CollegeLogo from './CollegeLogo';
import styles from './CampusAffiliation.module.css';

/** "Verified · <college>" next to the Campus title. */
export default function CampusVerifiedBadge({ affiliation, fallbackName }) {
  const name = affiliation?.collegeName || fallbackName;
  if (!name) return null;
  return (
    <span className={styles.badge} title={`College email verified for ${name}`}>
      {affiliation?.logoUrl ? (
        <CollegeLogo name={name} logoUrl={affiliation.logoUrl} />
      ) : (
        <CheckCircle2 size={14} aria-hidden="true" />
      )}
      <span className={styles.badgeText}>College verified</span>
    </span>
  );
}
