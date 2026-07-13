import { useData } from '../../context/DataContext';
import CommunityCoverArt from './CommunityCoverArt';
import styles from './FeaturedCommunity.module.css';

function formatNum(n) {
  if (n === undefined || n === null) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function getFallbackStatus(comm) {
  if (comm.members < 50) return 'Be One of the First Members';
  if (comm.members < 200) return 'Early Members Welcome';
  if (comm.created && (
    comm.created.includes('2025') || comm.created.includes('2026')
  )) return 'New Community';
  if (comm.members < 1000) return 'Growing Community';
  return 'Recently Created';
}

const BADGE_THRESHOLDS = {
  trending: { minGrowth: 20, minMembers: 500 },
  popular: { minMembers: 5000, minOnline: 100 },
  growing: { minGrowth: 10, minMembers: 100 },
};

function getFeaturedBadge(comm) {
  if (comm.trending && comm.newMembersThisWeek >= BADGE_THRESHOLDS.trending.minGrowth && comm.members >= BADGE_THRESHOLDS.trending.minMembers) {
    return { label: 'Trending This Week', icon: 'star' };
  }
  if (comm.members >= BADGE_THRESHOLDS.popular.minMembers && comm.online >= BADGE_THRESHOLDS.popular.minOnline) {
    return { label: 'Popular Community', icon: 'users' };
  }
  if (comm.newMembersThisWeek >= BADGE_THRESHOLDS.growing.minGrowth) {
    return { label: 'Fast Growing', icon: 'trending' };
  }
  return null;
}

function BadgeIcon({ type }) {
  switch (type) {
    case 'star':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case 'users':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'trending':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      );
    default:
      return null;
  }
}

function isNonZero(val) {
  return val != null && val !== '' && val !== 0 && Number(val) > 0;
}

export default function FeaturedCommunity({ comm, onClick }) {
  const { toggleJoinCommunity, currentUser } = useData();
  const isJoined = currentUser?.communities?.includes(comm.name);
  const badge = getFeaturedBadge(comm);
  const showGrowth = isNonZero(comm.newMembersThisWeek) && comm.growth;

  const stats = [
    { value: formatNum(comm.members), label: 'members' },
    isNonZero(comm.online) && { value: comm.online, label: 'active now' },
    isNonZero(comm.discussionsToday) && { value: comm.discussionsToday, label: 'discussions today' },
  ].filter(Boolean);

  const hasLiveActivity = isNonZero(comm.online) || isNonZero(comm.discussionsToday);

  return (
    <div className={styles.featured} onClick={onClick}>
      <div className={styles.featuredCover}>
        <CommunityCoverArt coverTheme={comm.coverTheme} />
        <div className={styles.featuredOverlay}>
          {badge && (
            <div className={styles.featuredBadge}>
              <BadgeIcon type={badge.icon} />
              {badge.label}
            </div>
          )}
          <h2 className={styles.featuredTitle}>{comm.name}</h2>
          <p className={styles.featuredDesc}>{comm.desc}</p>
          <div className={styles.featuredStats}>
            {stats.map((s) => (
              <div key={s.label} className={styles.featuredStat}>
                <span className={styles.featuredStatValue}>{s.value}</span>
                <span className={styles.featuredStatLabel}>{s.label}</span>
              </div>
            ))}
            {!hasLiveActivity && (
              <div className={styles.featuredStat}>
                <span className={styles.featuredFallbackLabel}>{getFallbackStatus(comm)}</span>
              </div>
            )}
          </div>
          {showGrowth && (
            <div className={styles.featuredGrowth}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              {comm.growth}
            </div>
          )}
          <button
            className={`${styles.featuredJoinBtn} ${isJoined ? styles.featuredJoined : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleJoinCommunity(comm.id); }}
          >
            {isJoined ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Joined
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Join Community
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
