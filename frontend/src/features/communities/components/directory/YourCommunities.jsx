import { useMemo } from 'react';
import { AlertCircle } from '@shared/components/icons';
import { useMyCommunities } from '@shared/hooks/useCommunities';
import CommunityRow from './CommunityRow';
import CommunityRowSkeleton from './CommunityRowSkeleton';
import SectionHeading from './SectionHeading';
import EmptyPanel from './EmptyPanel';
import { byRecentActivity } from './communityMeta';
import styles from './CommunityList.module.css';

// 3 words / 9 words.
const YOURS_TITLE = 'Communities you’ve joined';
const YOURS_SUBTITLE = 'Jump back into the groups you’re already part of.';

export default function YourCommunities({ onExplore, onCreate }) {
  const { myCommunities, isLoading, isError, refetch } = useMyCommunities();
  const sorted = useMemo(() => [...myCommunities].sort(byRecentActivity), [myCommunities]);

  if (isLoading) {
    return (
      <section className={styles.section} aria-busy="true" aria-label="Your communities">
        <CommunityRowSkeleton count={4} />
      </section>
    );
  }

  if (isError) {
    return (
      <section className={styles.section}>
        <div className={styles.state} role="alert">
          <span className={styles.stateIcon}><AlertCircle size={22} /></span>
          <h2 className={styles.stateTitle}>Couldn’t load your communities</h2>
          <p className={styles.stateText}>Check your connection and try again.</p>
          <div className={styles.stateActions}>
            <button type="button" className={styles.secondaryBtn} onClick={() => refetch()}>Try again</button>
          </div>
        </div>
      </section>
    );
  }

  if (sorted.length === 0) {
    return (
      <section className={styles.section} aria-label="Your communities">
        <SectionHeading title={YOURS_TITLE} subtitle={YOURS_SUBTITLE} />
        <EmptyPanel
          title="Nothing here yet"
          actions={(
            <>
              <button type="button" className={styles.primaryBtn} onClick={onExplore}>
                Explore communities
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={onCreate}>
                Create a community
              </button>
            </>
          )}
        >
          Communities you join will show up here.
        </EmptyPanel>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-label="Your communities">
      <SectionHeading title={YOURS_TITLE} subtitle={YOURS_SUBTITLE} />
      <div className={styles.list}>
        {sorted.map((c) => (
          <CommunityRow key={c.id} community={c} variant="mine" from="/communities" />
        ))}
      </div>
    </section>
  );
}
