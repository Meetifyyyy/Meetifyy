import Skeleton from '@shared/components/skeletons/Skeleton';
import cardStyles from './CrewCard.module.css';

export default function CrewCardSkeleton() {
  return (
    <div className={cardStyles.card} style={{ pointerEvents: 'none' }}>
      {/* Left Column: Cover Image */}
      <div className={cardStyles.coverCol}>
        <Skeleton type="rect" width="100%" height="100%" style={{ borderRadius: '18px' }} />
      </div>

      {/* Right Column: Details */}
      <div className={cardStyles.body}>
        {/* Top Row: Time label + More options button */}
        <div className={cardStyles.topRow}>
          <Skeleton type="text" width="130px" height="11px" style={{ margin: 0 }} />
          <Skeleton type="circle" width="16px" height="16px" style={{ margin: 0 }} />
        </div>

        {/* Title */}
        <Skeleton type="text" width="60%" height="20px" style={{ marginTop: '4px', marginBottom: '8px', borderRadius: '6px' }} />

        {/* Bottom Row: Overlapping avatars + Count + Bookmark */}
        <div className={cardStyles.bottomRow}>
          <div className={cardStyles.goingLine} style={{ gap: '8px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Skeleton type="circle" width="26px" height="26px" style={{ marginRight: '-8px', zIndex: 3 }} />
              <Skeleton type="circle" width="26px" height="26px" style={{ marginRight: '-8px', zIndex: 2 }} />
              <Skeleton type="circle" width="26px" height="26px" style={{ zIndex: 1 }} />
            </div>
            <Skeleton type="text" width="60px" height="11px" style={{ margin: 0 }} />
          </div>
          <Skeleton type="circle" width="22px" height="22px" style={{ margin: 0 }} />
        </div>
      </div>
    </div>
  );
}
