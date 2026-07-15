import { UsersIcon, UserIcon } from '@heroicons/react/24/solid';
import styles from './DefaultAvatar.module.css';

export default function DefaultAvatar({ className = '', style = {}, isGroup = false }) {
  return (
    <div className={`${styles.avatar} ${className}`} style={style}>
      {isGroup ? (
        <UsersIcon style={{ width: '60%', height: '60%', display: 'block', color: 'currentColor' }} />
      ) : (
        <UserIcon style={{ width: '60%', height: '60%', display: 'block', color: 'currentColor' }} />
      )}
    </div>
  );
}
