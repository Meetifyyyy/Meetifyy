import Skeleton from '../common/Skeleton';
import cardStyles from './CrewCard.module.css';

export default function CrewCardSkeleton() {
  return (
    <div className={cardStyles.card} style={{ pointerEvents: 'none' }}>
      {/* Avatar column */}
      <div className={cardStyles.avatarCol}>
        <Skeleton type="circle" width="48px" height="48px" />
      </div>

      {/* Body */}
      <div className={cardStyles.body} style={{ flex: 1, minWidth: 0 }}>
        {/* Category tag + title */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
          <Skeleton type="rect" width="60px" height="18px" style={{ borderRadius: '100px' }} />
          <Skeleton type="text" width="70%" height="16px" style={{ marginBottom: 0 }} />
        </div>

        {/* Description */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
          <Skeleton type="text" width="100%" height="11px" style={{ marginBottom: 0 }} />
          <Skeleton type="text" width="60%" height="11px" style={{ marginBottom: 0 }} />
        </div>

        {/* Meta rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <Skeleton type="text" width="80px" height="11px" style={{ marginBottom: 0 }} />
            <Skeleton type="text" width="60px" height="11px" style={{ marginBottom: 0 }} />
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <Skeleton type="text" width="90px" height="11px" style={{ marginBottom: 0 }} />
            <Skeleton type="text" width="40px" height="11px" style={{ marginBottom: 0 }} />
          </div>
        </div>

        {/* Bottom row: host + join button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Skeleton type="circle" width="20px" height="20px" />
            <Skeleton type="text" width="80px" height="11px" style={{ marginBottom: 0 }} />
          </div>
          <Skeleton type="rect" width="70px" height="32px" style={{ borderRadius: '100px' }} />
        </div>
      </div>
    </div>
  );
}
