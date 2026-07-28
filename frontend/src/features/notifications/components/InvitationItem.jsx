import { isImageUrl } from '@shared/utils/avatar';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import styles from './InvitationItem.module.css';

export default function InvitationItem({
  inv,
  isRead,
  onNavigateHost,
  onAccept,
  onDecline,
  onViewActivity
}) {
  return (
    <div 
      className={`${styles.invitationItem} ${!isRead ? styles.unread : ''}`} 
      onClick={() => onViewActivity(inv)}
    >
      <div className={styles.avatar}>
        {isImageUrl(inv.hostAvatar) ? (
          <img src={inv.hostAvatar} alt={inv.hostName || "Host"} className={styles.avatarImg}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
        ) : (
          <DefaultAvatar />
        )}
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

        {(inv.startDate || inv.location) && (
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', display: 'flex', gap: '0.75rem', marginTop: '0.15rem' }}>
            {inv.startDate && (
              <span>{new Date(inv.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            )}
            {inv.location && <span>• {inv.location}</span>}
          </div>
        )}

        <div className={styles.invitationActions}>
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
        </div>
      </div>
    </div>
  );
}
