import { useNavigate } from 'react-router-dom';
import { useFollowRequests } from '@shared/hooks/useFollowRequests';
import Avatar from '@shared/components/avatar/Avatar';
import { ChevronRight } from '@shared/components/icons';
import styles from './FollowRequestsRow.module.css';

/**
 * The entry to the follow requests page, at the top of Notifications: up to
 * two of the newest requesters' avatars and how many are waiting. Absent when
 * nothing is.
 */
export default function FollowRequestsRow() {
  const navigate = useNavigate();
  const { requests, total } = useFollowRequests();
  if (total <= 0) return null;

  const shown = requests.slice(0, 2);
  return (
    <button
      type="button"
      className={styles.row}
      onClick={() => navigate('/notifications/follow-requests', { state: { from: '/notifications' } })}
    >
      <span className={styles.avatars} aria-hidden="true">
        {shown.map(({ user }, i) => (
          <span key={user.id} className={i === 0 ? styles.avatar : `${styles.avatar} ${styles.avatarBehind}`}>
            <Avatar src={user.avatar} name={user.displayName || user.username} size="32px" />
          </span>
        ))}
      </span>
      <span className={styles.text}>
        <span className={styles.title}>Follow requests</span>
        <span className={styles.count}>{total} {total === 1 ? 'request' : 'requests'}</span>
      </span>
      <ChevronRight size={18} className={styles.chevron} />
    </button>
  );
}
