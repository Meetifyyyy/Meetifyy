import Skeleton from '@shared/components/skeletons/Skeleton';
import HomeCommunities from '@features/communities/components/home/HomeCommunities';
import PostSkeleton from './PostSkeleton';
import styles from '../Feed.module.css';
import panelStyles from '@layout/RightPanel.module.css';

/**
 * The collapsed PostComposer is one fixed-height row (40px avatar inside
 * 0.75rem of padding), so a single block of that height holds its place. Its
 * controls are not drawn as separate pieces: the real composer replaces the
 * whole block at once.
 */
function ComposerSkeleton() {
  return (
    <Skeleton
      type="rect"
      height="64px"
      style={{ display: 'block', borderRadius: 'var(--radius-xl)' }}
    />
  );
}

/** A right-panel card: its real title, then one block for its content. */
function PanelCardSkeleton({ title, height }) {
  return (
    <div className={panelStyles.panelCard}>
      <h3 className={panelStyles.panelTitle}>{title}</h3>
      <Skeleton type="rect" height={height} style={{ display: 'block' }} />
    </div>
  );
}

/**
 * Full home page skeleton — mirrors FeedRoute's output: composer, the "Your
 * communities" strip, then posts. The strip is the real component: it draws
 * its own title and loading tiles (or the cached communities), and it is the
 * same component Feed mounts, so nothing below it moves when the page arrives.
 */
export default function HomeSkeleton() {
  return (
    <>
      <main className="centre" aria-busy="true">
        <div className={styles.feed}>
          <ComposerSkeleton />
          <HomeCommunities />
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </div>
      </main>

      {/* Right panel (hidden below 1100px by its own CSS). */}
      <aside className={panelStyles.rightPanel} aria-hidden="true">
        <PanelCardSkeleton title="Online Friends" height="70px" />
        <PanelCardSkeleton title="Recent Activity" height="140px" />
        <PanelCardSkeleton title="My Upcoming Activities" height="110px" />
      </aside>
    </>
  );
}
