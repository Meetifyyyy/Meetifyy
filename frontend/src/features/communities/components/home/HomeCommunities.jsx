import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Users } from '@shared/components/icons';
import { useMyCommunities } from '@shared/hooks/useCommunities';
import CommunityAvatar from '../directory/CommunityAvatar';
import { byRecentActivity } from '../directory/communityMeta';
import styles from './HomeCommunities.module.css';

const SHOWN = 10;

/**
 * "Your communities" on Home: a quick way into the viewer's communities, most
 * recently active first. Shares the `['communities','mine']` cache with the
 * Communities page, so opening either one after the other costs no request.
 */
function HomeCommunities() {
  const { myCommunities, isLoading, isError } = useMyCommunities();
  const shown = useMemo(
    () => [...myCommunities].sort(byRecentActivity).slice(0, SHOWN),
    [myCommunities],
  );

  if (isError) return null;

  if (!isLoading && shown.length === 0) {
    return (
      <Link to="/communities?tab=explore" className={`${styles.card} ${styles.prompt}`}>
        <span className={styles.promptIcon}><Users size={20} aria-hidden="true" /></span>
        <span className={styles.promptText}>
          <span className={styles.promptTitle}>Find your communities</span>
          <span className={styles.promptSub}>Join a few and their posts show up here.</span>
        </span>
        <ChevronRight size={18} className={styles.promptChevron} />
      </Link>
    );
  }

  return (
    <section className={styles.card} aria-label="Your communities" aria-busy={isLoading}>
      <div className={styles.header}>
        <h2 className={styles.title}>Your communities</h2>
        <Link to="/communities" className={styles.seeAll}>See all</Link>
      </div>
      <ul className={styles.strip}>
        {isLoading
          ? Array.from({ length: 5 }, (_, i) => (
            <li key={i} className={styles.item} aria-hidden="true">
              <span className={styles.ghostAvatar} />
              <span className={styles.ghostName} />
            </li>
          ))
          : shown.map((c) => (
            <li key={c.id} className={styles.item}>
              <Link to={`/communities/${c.id}`} state={{ from: '/home' }} className={styles.tile} title={c.name}>
                <CommunityAvatar community={c} size={56} />
                <span className={styles.name}>{c.name}</span>
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}

export default memo(HomeCommunities);
