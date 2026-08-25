import styles from './InvitationItem.module.css';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { getMediaUrl } from '@shared/api/apiClient';
import { DEFAULT_ACTIVITY_COVERS, getDefaultActivityCover } from '@shared/utils/activityCover';
import {
  INVITE_STATUS,
  INVITE_STATUS_LABEL,
  resolveInviteStatus,
} from '../utils/inviteLifecycle';

const STATUS_CLASS = {
  [INVITE_STATUS.ACCEPTED]: 'statusAccepted',
  [INVITE_STATUS.DECLINED]: 'statusDeclined',
  [INVITE_STATUS.CANCELLED]: 'statusCancelled',
  [INVITE_STATUS.EXPIRED]: 'statusExpired',
};

export default function InvitationItem({
  inv,
  isRead,
  onNavigateHost,
  onAccept,
  onDecline,
  onViewActivity,
  isBusy = false,
}) {
  // A settled invite keeps its row and shows the outcome; only a genuinely
  // pending one still offers Accept / Decline.
  const status = resolveInviteStatus(inv);
  const isPending = status === INVITE_STATUS.PENDING;

  const rawCover = inv.coverImage || inv.image || inv.cover || null;
  const coverSrc = rawCover ? getMediaUrl(rawCover) : getDefaultActivityCover(inv.title || inv.id || '');

  return (
    <div 
      className={`${styles.invitationItem} ${!isRead ? styles.unread : ''} ${!isPending ? styles.settled : ''}`}
      data-invite-status={status}
      
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
          {!isPending ? (
            <span
              className={`${styles.statusPill} ${styles[STATUS_CLASS[status]] || ''}`}
              data-status={status}
            >
              {INVITE_STATUS_LABEL[status]}
            </span>
          ) : (
            <>
              {/* Disabled in flight: the accept request joins the activity and
                  then redirects, so a second click would fire a redundant
                  request while the first is still completing. The backend is
                  idempotent regardless — this is only to keep the UI honest. */}
              <button 
                className={styles.acceptBtn}
                disabled={isBusy}
                aria-busy={isBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isBusy) return;
                  onAccept(inv.id, inv);
                }}
              >
                {isBusy ? 'Joining…' : 'Accept'}
              </button>
              <button 
                className={styles.declineBtn}
                disabled={isBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isBusy) return;
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
