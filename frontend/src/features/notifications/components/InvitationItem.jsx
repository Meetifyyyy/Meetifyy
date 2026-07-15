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
          <img src={inv.hostAvatar} alt={inv.hostName || "Host"} className={styles.avatarImg} />
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
            {inv.hostName}
          </span>
          {' '}
          <span className={styles.actionText}>invited you to <strong>{inv.title}</strong></span>
        </div>
        <div className={styles.invitationActions}>
          <button 
            className={styles.acceptBtn}
            onClick={(e) => {
              e.stopPropagation();
              onAccept(inv.id);
            }}
          >
            Accept
          </button>
          <button 
            className={styles.declineBtn}
            onClick={(e) => {
              e.stopPropagation();
              onDecline(inv.id);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
