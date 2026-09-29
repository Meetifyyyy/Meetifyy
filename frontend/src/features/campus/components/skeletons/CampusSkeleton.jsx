import { useNavigate } from 'react-router-dom';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { useAuth } from '@shared/context/AuthContext';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { Plus, Users } from '@shared/components/icons';
import CampusEventSection from '@features/campus-events/components/CampusEventSection';
import CrewCardSkeleton from '@features/crew/components/cards/CrewCardSkeleton';
import sharedStyles from './CampusShared.module.css';
import pageStyles from '../../pages/CampusPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };

/** A section's static title row: its emoji and its name. */
function SectionTitle({ emoji, title }) {
  return (
    <div className={styles.sectionHeaderRow}>
      <span className={styles.sectionEmoji}>{emoji}</span>
      <h2 className={styles.sectionTitleText}>{title}</h2>
    </div>
  );
}

/** "You may know" while the campus users load: avatar + name blocks. */
function SuggestedUsersSkeleton({ count = 4 }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={i} className={styles.knowCard} aria-hidden="true">
      <Skeleton type="circle" width="88px" height="88px" />
      <Skeleton type="text" width="64px" height="0.7rem" style={{ margin: 0 }} />
    </div>
  ));
}

/**
 * Route fallback for /campus, in the same order as CampusPage: header and tabs,
 * then "you may know" + "discover communities", campus events, campus
 * activities. Everything static — the college name, the tabs, each section's
 * emoji and title, the directory button and the create-community card — is
 * drawn for real; only the content of each section is a placeholder.
 */
export default function CampusSkeleton() {
  const navigate = useNavigate();
  const { currentUser, collegeName } = useAuth();

  return (
    <main className={`centre centre-wide ${styles.hubContainer}`} aria-busy="true">
      <div className={styles.headerBanner}>
        <header className={styles.header}>
          <h1 className={styles.collegeTitle} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1 }}>
            <span>{collegeName}</span>
            <CollegeRepresentativeBadge isCampusRep={Boolean(currentUser?.isCampusRep)} collegeName={collegeName} size="inherit" />
          </h1>
          <div className={`${styles.headerActions} ${styles.headerActionsRelative}`}>
            {/* Its menu belongs to the page; drawn here so the header is whole. */}
            <button type="button" className={styles.headerSquareBtn} tabIndex={-1} aria-hidden="true">
              <Plus size={20} />
            </button>
          </div>
        </header>

        <div className={styles.stickyNav}>
          <button type="button" className={styles.navTab} onClick={() => navigate('/campus/events')}>
            <span className={styles.tabEmoji}>🎟️</span>
            <span>Events</span>
          </button>
          <button type="button" className={styles.navTab} onClick={() => navigate('/campus/directory')}>
            <span className={styles.tabEmoji}>🤩</span>
            <span>Directory</span>
          </button>
          <button type="button" className={styles.navTab} onClick={() => navigate('/campus/communities')}>
            <span className={styles.tabEmoji}>🫧</span>
            <span>Communities</span>
          </button>
        </div>
      </div>

      <div className={styles.campusBody}>
        <div className={styles.sideBySideDesktop}>
          <section className={`${styles.section} ${styles.sideSection}`}>
            <SectionTitle emoji="🤩" title="you may know" />
            <div className={styles.knowListContainer}>
              <SuggestedUsersSkeleton />
            </div>
            <button type="button" className={styles.viewDirBtn} onClick={() => navigate('/campus/directory')}>
              View directory
            </button>
          </section>

          <section className={`${styles.section} ${styles.sideSection}`}>
            <SectionTitle emoji="🫧" title="discover communities" />
            <div className={styles.communitiesSectionWrapper} aria-hidden="true">
              {/* One block the height of a community card row. */}
              <Skeleton
                type="rect"
                height="calc(52px + 1.9rem + 2px)"
                style={{ display: 'block', borderRadius: 'var(--radius-lg, 16px)' }}
              />
            </div>
            <div className={styles.discoverGroupsCard} aria-hidden="true">
              <div className={styles.dashedAddSquare}>
                <Users size={20} />
                <span className={styles.plusOverlay}>+</span>
              </div>
              <span className={styles.discoverGroupsText}>Create a campus community</span>
            </div>
          </section>
        </div>

        <section className={styles.section}>
          <SectionTitle emoji="🎟️" title="campus events" />
          <CampusEventSection scope="upcoming" showCount={false} isLoading />
        </section>

        <section className={styles.section}>
          <SectionTitle emoji="🎉" title="campus activities" />
          <CrewCardSkeleton />
          <CrewCardSkeleton />
        </section>
      </div>
    </main>
  );
}
