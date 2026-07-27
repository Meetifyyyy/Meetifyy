import Skeleton from '@shared/components/skeletons/Skeleton';
import cardStyles from './CrewCard.module.css';

export default function CrewCardSkeleton() {
  return (
    <div className={cardStyles.card} style={{ pointerEvents: 'none' }}>
      {/* Left Column: Cover Image & Calendar Badge */}
      <div className={cardStyles.coverCol}>
        <Skeleton type="rect" width="100%" height="100%" style={{ borderRadius: '18px' }} />
        <div className={cardStyles.calendarBadge}>
          <Skeleton type="rect" width="38px" height="42px" style={{ borderRadius: '8px' }} />
        </div>
      </div>

      {/* Right Column: Details */}
      <div className={cardStyles.body}>
        {/* Top Row: Time label + More options button */}
        <div className={cardStyles.topRow}>
          <Skeleton type="text" width="140px" height="13px" style={{ marginBottom: 0 }} />
          <Skeleton type="circle" width="20px" height="20px" />
        </div>

        {/* Title */}
        <Skeleton type="text" width="65%" height="22px" style={{ marginTop: '6px', marginBottom: '12px', borderRadius: '6px' }} />

        {/* Bottom Row: Overlapping avatars + Count + Bookmark */}
        <div className={cardStyles.bottomRow}>
          <div className={cardStyles.goingLine} style={{ gap: '8px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Skeleton type="circle" width="26px" height="26px" style={{ marginRight: '-6px' }} />
              <Skeleton type="circle" width="26px" height="26px" style={{ marginRight: '-6px' }} />
              <Skeleton type="circle" width="26px" height="26px" />
            </div>
            <Skeleton type="text" width="70px" height="12px" style={{ marginBottom: 0 }} />
          </div>
          <Skeleton type="rect" width="20px" height="20px" style={{ borderRadius: '4px' }} />
        </div>
      </div>
    </div>
  );
}
