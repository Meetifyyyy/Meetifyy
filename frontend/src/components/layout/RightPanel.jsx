import { useData } from '../../context/DataContext';
import styles from './RightPanel.module.css';

export default function RightPanel({ children, className = '' }) {
  return <aside className={`${styles.rightPanel} ${className}`.trim()}>{children}</aside>;
}

export function QuickActions({ actions }) {
  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>Quick Actions</h3>
      {actions.map((a, i) => (
        <button key={i} className={styles.actionBtn} onClick={a.onClick}>
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  );
}

export function OnlineFriends() {
  const { users, currentUser } = useData();

  const friends = Object.values(users)
    .filter(u => u.id !== currentUser.id)
    .slice(0, 4)
    .map((u, i) => ({
      id: u.id,
      name: u.displayName,
      username: u.username,
      letter: u.avatar,
      status: i < 2 ? 'Online' : (i === 2 ? 'Away' : 'Offline'),
      online: i < 2
    }));

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>Online Friends</h3>
      {friends.map((f, i) => (
        <div key={i} className={styles.friendItem}>
          <div className={styles.friendAvatar}>{f.letter}</div>
          <div className={styles.friendInfo}>
            <div className={styles.friendName}>{f.name}</div>
            <div className={`${styles.friendStatus}${f.online ? ` ${styles.online}` : ''}`}>{f.status}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function UpcomingEvents() {
  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>Upcoming</h3>
      <div className={styles.eventItem}>
        <div className={styles.eventDate}>Today<br /><span>3PM</span></div>
        <div className={styles.eventDetail}>
          <div className={styles.eventName}>Team Standup</div>
          <div className={styles.eventMeta}>30 min</div>
        </div>
      </div>
      <div className={styles.eventItem}>
        <div className={styles.eventDate}>Fri<br /><span>11AM</span></div>
        <div className={styles.eventDetail}>
          <div className={styles.eventName}>Design Review</div>
          <div className={styles.eventMeta}>1 hr</div>
        </div>
      </div>
    </div>
  );
}
