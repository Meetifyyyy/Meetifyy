import { useNavigate, useLocation } from 'react-router-dom';
import Skeleton from '@shared/components/skeletons/Skeleton';
import pageStyles from '../pages/ActivityDetailPage.module.css';
import styles from './skeletons/ActivityDetailSkeleton.module.css';

/**
 * Pixel-accurate skeleton for ActivityDetailPage.
 *
 * Renders the real page chrome (ambient bg, glass card, top-bar with a live
 * back button) immediately, then fills every content region with shimmer
 * blocks that match the final layout exactly — preventing layout shifts when
 * the real data arrives.
 */
export default function ActivityDetailSkeleton() {
  const navigate  = useNavigate();
  const location  = useLocation();

  return (
    <div data-theme="dark" className={pageStyles.root}>
      {/* Ambient dark gradient stands in for the blurred cover */}
      <div className={pageStyles.ambientBg} />

      <div className={pageStyles.glass}>

        {/* ── Top bar — real back button, shimmer action buttons ── */}
        <div className={pageStyles.topBar}>
          <div className={pageStyles.headerLeft}>
            <button
              className={pageStyles.backBtn}
              onClick={() => navigate(location.state?.from ?? '/crew', { replace: true })}
              aria-label="Go back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          </div>
          <div className={pageStyles.rightActions}>
            <Skeleton type="circle" width="34px" height="34px" />
            <Skeleton type="circle" width="34px" height="34px" />
          </div>
        </div>

        {/* ── Scroll area ─────────────────────────────────────── */}
        <div className={pageStyles.scrollArea}>
          <div className={pageStyles.contentRow}>

            {/* ── Left column: cover + desktop attendees ────── */}
            <div className={pageStyles.imgCol}>
              {/* Title */}
              <Skeleton
                type="rect"
                height="2rem"
                style={{ borderRadius: 8, marginBottom: '1.25rem', width: '80%', display: 'block', margin: '0 auto 1.25rem' }}
              />

              {/* Cover image square */}
              <div className={pageStyles.imgSquare}>
                <Skeleton
                  type="rect"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 24 }}
                />
              </div>

              {/* Desktop-only attendees */}
              <div className={`${pageStyles.attendeesSection} ${pageStyles.desktopOnlyAttendees}`}>
                <Skeleton type="text" width="110px" height="1rem" style={{ marginBottom: '1.25rem', borderRadius: 6 }} />
                {[0, 1, 2].map((i) => (
                  <div key={i} className={styles.attendeeRow}>
                    <Skeleton type="circle" width="44px" height="44px" />
                    <div className={styles.attendeeMeta}>
                      <Skeleton type="text" width="72%" height="0.88rem" style={{ marginBottom: '0.3rem', borderRadius: 4 }} />
                      <Skeleton type="text" width="50%" height="0.72rem" style={{ borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Right column: info + host + desc + discussion ─ */}
            <div className={pageStyles.detailsCol}>

              {/* Date / location glass card */}
              <div className={pageStyles.leftInfoBlock} style={{ marginTop: 0, marginBottom: '2rem' }}>
                <div className={styles.infoRow}>
                  <Skeleton type="rect" width="32px" height="32px" style={{ borderRadius: 6, flexShrink: 0 }} />
                  <Skeleton type="text" height="0.95rem" style={{ flex: 1, borderRadius: 5 }} />
                </div>
                <div className={styles.infoRow}>
                  <Skeleton type="rect" width="32px" height="32px" style={{ borderRadius: 6, flexShrink: 0 }} />
                  <Skeleton type="text" width="55%" height="0.95rem" style={{ borderRadius: 5 }} />
                </div>
              </div>

              {/* Host row glass card */}
              <div className={pageStyles.hostRow}>
                <Skeleton type="circle" width="44px" height="44px" style={{ flexShrink: 0 }} />
                <div className={styles.hostMeta}>
                  <Skeleton type="text" width="55px" height="0.72rem" style={{ marginBottom: '0.35rem', borderRadius: 4 }} />
                  <Skeleton type="text" width="130px" height="0.92rem" style={{ borderRadius: 4 }} />
                </div>
              </div>

              {/* Description lines */}
              <div className={styles.descBlock}>
                <Skeleton type="text" height="0.82rem" style={{ marginBottom: '0.5rem', borderRadius: 4 }} />
                <Skeleton type="text" width="88%" height="0.82rem" style={{ marginBottom: '0.5rem', borderRadius: 4 }} />
                <Skeleton type="text" width="65%" height="0.82rem" style={{ borderRadius: 4 }} />
              </div>

              {/* Mobile-only attendees */}
              <div className={`${pageStyles.attendeesSection} ${pageStyles.mobileOnlyAttendees}`}>
                <Skeleton type="text" width="110px" height="1rem" style={{ marginBottom: '1.25rem', borderRadius: 6 }} />
                {[0, 1].map((i) => (
                  <div key={i} className={styles.attendeeRow}>
                    <Skeleton type="circle" width="44px" height="44px" />
                    <div className={styles.attendeeMeta}>
                      <Skeleton type="text" width="72%" height="0.88rem" style={{ marginBottom: '0.3rem', borderRadius: 4 }} />
                      <Skeleton type="text" width="50%" height="0.72rem" style={{ borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Discussion panel skeleton */}
              <Skeleton
                type="rect"
                height="380px"
                style={{ borderRadius: 18, display: 'block', marginTop: '1rem' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
