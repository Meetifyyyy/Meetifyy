import { UsersIcon, UserIcon } from '@heroicons/react/24/solid';
import styles from './DefaultAvatar.module.css';

export default function DefaultAvatar({ className = '', style = {}, isGroup = false }) {
  return (
    <div
      className={`${styles.avatar} ${className}`}
      style={{
        background: 'var(--color-primary, #2563EB)',
        color: '#ffffff',
        ...style
      }}
    >
      {isGroup ? (
        <UsersIcon style={{ width: '60%', height: '60%', display: 'block', color: '#ffffff' }} />
      ) : (
        <UserIcon style={{ width: '60%', height: '60%', display: 'block', color: '#ffffff' }} />
      )}
    </div>
  );
}
