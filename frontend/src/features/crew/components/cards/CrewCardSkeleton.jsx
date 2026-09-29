import Skeleton from '@shared/components/skeletons/Skeleton';
import cardStyles from './CrewCard.module.css';

/**
 * A crew card while it loads: the cover block and two lines of text. The card
 * and its columns have fixed heights, so it occupies exactly the real card's
 * space without drawing its small icons and avatars one by one.
 */
export default function CrewCardSkeleton() {
  return (
    <div className={cardStyles.card} style={{ pointerEvents: 'none' }} aria-hidden="true">
      <div className={cardStyles.coverCol}>
        <Skeleton type="rect" width="100%" height="100%" style={{ display: 'block', borderRadius: '18px' }} />
      </div>

      <div className={cardStyles.body} style={{ justifyContent: 'center', gap: '10px' }}>
        <Skeleton type="text" width="65%" height="18px" style={{ margin: 0, borderRadius: '6px' }} />
        <Skeleton type="text" width="40%" height="12px" style={{ margin: 0 }} />
      </div>
    </div>
  );
}
