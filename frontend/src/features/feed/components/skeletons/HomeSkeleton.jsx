import Skeleton from '@shared/components/skeletons/Skeleton';
import PostSkeleton from './PostSkeleton';
import styles from '../Feed.module.css';
import panelStyles from '@layout/RightPanel.module.css';

/** Skeleton for the right panel card — mirrors panelCard structure */
function PanelCardSkeleton({ rows = 3, hasTitle = true }) {
  return (
    <div className={panelStyles.panelCard} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {hasTitle && <Skeleton type="text" width="100px" height="12px" style={{ marginBottom: '0.25rem' }} />}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <Skeleton type="circle" width="36px" height="36px" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <Skeleton type="text" width={i % 2 === 0 ? '70%' : '50%'} height="11px" style={{ marginBottom: 0 }} />
            <Skeleton type="text" width="40%" height="9px" style={{ marginBottom: 0 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for the PostComposer box */
function ComposerSkeleton() {
  return (
    <div style={{
      background: 'var(--color-bg-white)',
      border: '1px solid var(--color-border-light)',
      borderRadius: 'var(--radius-xl)',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.6rem',
      boxShadow: 'var(--shadow-sm)',
    }}>
      {/* Top row: avatar + input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
        <Skeleton type="circle" width="40px" height="40px" />
        <Skeleton type="rect" width="100%" height="36px" style={{ borderRadius: '20px' }} />
      </div>
      {/* Bottom row: action icons + send button */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: '0.5rem',
        borderTop: '1px solid var(--color-border-light)',
      }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Skeleton type="rect" width="64px" height="28px" style={{ borderRadius: 'var(--radius-sm)' }} />
          <Skeleton type="rect" width="64px" height="28px" style={{ borderRadius: 'var(--radius-sm)' }} />
          <Skeleton type="rect" width="64px" height="28px" style={{ borderRadius: 'var(--radius-sm)' }} />
        </div>
        <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
      </div>
    </div>
  );
}

/** Skeleton for the upcoming events panel card */
function EventsPanelSkeleton() {
  return (
    <div className={panelStyles.panelCard} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Skeleton type="text" width="140px" height="12px" style={{ marginBottom: 0 }} />
      {[0, 1].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Skeleton type="rect" width="44px" height="46px" style={{ borderRadius: '10px', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Skeleton type="text" width={i === 0 ? '80%' : '65%'} height="11px" style={{ marginBottom: 0 }} />
            <Skeleton type="text" width="45%" height="9px" style={{ marginBottom: 0 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Full home page skeleton — mirrors FeedRoute's exact output structure */
export default function HomeSkeleton() {
  return (
    <>
      {/* Centre column: matches <main className="centre"> */}
      <main className="centre">
        <div className={styles.feed}>
          <ComposerSkeleton />
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </div>
      </main>

      {/* Right panel: matches <RightPanel> */}
      <aside className={panelStyles.rightPanel}>
        {/* Online Friends card */}
        <div className={panelStyles.panelCard} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <Skeleton type="text" width="90px" height="12px" style={{ marginBottom: '0.25rem' }} />
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '56px' }}>
                <Skeleton type="circle" width="48px" height="48px" />
                <Skeleton type="text" width="40px" height="9px" style={{ marginBottom: 0 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity card */}
        <PanelCardSkeleton rows={3} hasTitle />

        {/* Upcoming Events card */}
        <EventsPanelSkeleton />
      </aside>
    </>
  );
}
