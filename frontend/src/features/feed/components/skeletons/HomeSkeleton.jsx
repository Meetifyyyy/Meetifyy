import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import VerificationGate from '@shared/components/VerificationGate/VerificationGate';
import HomeCommunities from '@features/communities/components/home/HomeCommunities';
import HomePostSkeleton from './HomePostSkeleton';
import composerStyles from '../composer/PostComposer.module.css';
import styles from '../Feed.module.css';
import panelStyles from '@layout/RightPanel.module.css';
import skeletonStyles from './HomeSkeleton.module.css';

/**
 * The composer is not a skeleton: it waits for no data, so it is drawn as
 * itself - the collapsed card, the viewer's avatar and the placeholder - and
 * the real PostComposer takes its place. Behind the same verification gate as
 * the real one, so an unverified viewer sees the same notice in both.
 */
function ComposerStandIn() {
  const { currentUser, loading } = useAuth();
  return (
    <VerificationGate message="Verify your account to create posts.">
      <div className={skeletonStyles.composerWrap}>
        <div className={composerStyles.postComposer}>
          <div className={composerStyles.composerTopRow}>
            <Avatar src={currentUser?.avatar} name={currentUser?.displayName} size="40px" disableHover isLoading={loading} />
            <span className={skeletonStyles.composerPlaceholder}>What&apos;s on your mind?</span>
          </div>
        </div>
      </div>
    </VerificationGate>
  );
}

/** A right-panel card with its real title and a spinner where its content will be. */
function PanelCardLoading({ title }) {
  return (
    <div className={panelStyles.panelCard}>
      <h3 className={panelStyles.panelTitle}>{title}</h3>
      <div className={skeletonStyles.panelSpinner}>
        <div className="spinner" style={{ '--spinner-size': '24px', '--spinner-border-width': '2.5px' }} role="status" aria-label={`Loading ${title}`} />
      </div>
    </div>
  );
}

/**
 * The Home page while its route loads - mirrors FeedRoute's output.
 *
 *  - The composer and the "Your communities" strip are the page's real
 *    components (the strip draws its own loading tiles), so nothing above the
 *    posts moves when the page arrives.
 *  - Posts are a plain skeleton: author, a couple of lines and a picture on
 *    some. The feed's own first load shows the same ones.
 *  - The right panel keeps each card's title and shows a spinner inside it.
 */
export default function HomeSkeleton() {
  return (
    <>
      <main className="centre" aria-busy="true">
        <div className={styles.feed}>
          <ComposerStandIn />
          <HomeCommunities />
          <HomePostSkeleton media />
          <HomePostSkeleton />
          <HomePostSkeleton media />
        </div>
      </main>

      {/* Right panel (hidden below 1100px by its own CSS). */}
      <aside className={panelStyles.rightPanel} aria-hidden="true">
        <PanelCardLoading title="Online Friends" />
        <PanelCardLoading title="Recent Activity" />
        <PanelCardLoading title="My Upcoming Activities" />
      </aside>
    </>
  );
}
