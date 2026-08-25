import styles from './InvitationItem.module.css';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { getMediaUrl } from '@shared/api/apiClient';
import { DEFAULT_ACTIVITY_COVERS, getDefaultActivityCover } from '@shared/utils/activityCover';

export default function InvitationItem({
  inv,
  isRead,
  onNavigateHost,
  onAccept,
  onDecline,
  onViewActivity
}) {
  const isExpired = 
    inv.activityStatus === 'ENDED' || 
    inv.activityStatus === 'COMPLETED' || 
    inv.activityStatus === 'CANCELLED' || 
    (inv.startDate && new Date(inv.startDate) < new Date());

  const rawCover = inv.coverImage || inv.image || inv.cover || null;
  const coverSrc = rawCover ? getMediaUrl(rawCover) : getDefaultActivityCover(inv.title || inv.id || '');

  return (
    <div 
      className={`${styles.invitationItem} ${!isRead ? styles.unread : ''}`} 
      onClick={() => onViewActivity(inv)}
    >
      {/* Activity cover + calendar badge (matching CrewCard style) */}
      <div className={styles.activityThumb}>
        <img
          src={coverSrc}
          alt={inv.title || 'Activity'}
          className={styles.activityImg}
          onError={(e) => { e.target.onerror = null; e.target.src = DEFAULT_ACTIVITY_COVERS[0]; }}
        />
        <div className={styles.calendarBadge}>
          <CalendarIcon
            date={inv.startDate}
            size="badge"
            style={{ border: '2.5px solid var(--color-bg-white, #ffffff)', boxShadow: 'none' }}
          />
        </div>
      </div>

      <div className={styles.content}>
        <div>
          <span 
            className={styles.actorName}
            onClick={(e) => {
              e.stopPropagation();
              onNavigateHost(inv.hostId);
            }}
            style={{ cursor: 'pointer' }}
          >
            {inv.hostName || 'Someone'}
          </span>
          {' '}
          <span className={styles.actionText}>invited you to <strong>{inv.title}</strong></span>
        </div>

        {inv.startDate && (
          <div style={{ fontSize: '0.77rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
            {new Date(inv.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        )}

        <div className={styles.invitationActions}>
          {isExpired ? (
            <span className={styles.expiredText}>Expired</span>
          ) : (
            <>
              <button 
                className={styles.acceptBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept(inv.id, inv);
                }}
              >
                Accept
              </button>
              <button 
                className={styles.declineBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onDecline(inv.id, inv);
                }}
              >
                Decline
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
