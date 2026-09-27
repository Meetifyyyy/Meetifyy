import { Link } from 'react-router-dom';
import { Plus, School } from '@shared/components/icons';
import { useAuth } from '@shared/context/AuthContext';
import { useCommunityRecommendations } from '@shared/hooks/useCommunityRecommendations';
import CommunityAvatar from './CommunityAvatar';
import { memberLabel } from './communityMeta';
import styles from './CommunitiesAside.module.css';

/**
 * The right-hand column on wide screens. Secondary by design: things worth a
 * glance that the centre column does not already show.
 */
export default function CommunitiesAside({ onCreate }) {
  const { currentUser } = useAuth();
  const { recommendations, isLoading } = useCommunityRecommendations(4);
  const hasCampus = Boolean(currentUser?.collegeId);

  return (
    <aside className={styles.aside} aria-label="More communities">
      {(isLoading || recommendations.length > 0) && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Suggested for you</h2>
          {isLoading ? (
            <div className={styles.placeholder} aria-hidden="true" />
          ) : (
            <ul className={styles.suggestions}>
              {recommendations.map((c) => (
                <li key={c.id}>
                  <Link to={`/communities/${c.id}`} className={styles.suggestion}>
                    <CommunityAvatar community={c} size={36} />
                    <span className={styles.suggestionText}>
                      <span className={styles.suggestionName}>{c.name}</span>
                      <span className={styles.suggestionMeta}>
                        {c.isPrivate ? 'Private · ' : ''}{memberLabel(c)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {hasCampus && (
        <Link to="/campus/communities" className={`${styles.card} ${styles.linkCard}`}>
          <School size={20} className={styles.linkIcon} aria-hidden="true" />
          <span>
            <span className={styles.linkTitle}>Campus communities</span>
            <span className={styles.linkText}>Groups open only to verified students of your college.</span>
          </span>
        </Link>
      )}

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Start a community</h2>
        <p className={styles.cardText}>
          Make it public for anyone to join, or private so you approve each member.
        </p>
        <button type="button" className={styles.createBtn} onClick={onCreate}>
          <Plus size={16} /> Create community
        </button>
      </section>
    </aside>
  );
}
