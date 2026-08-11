import { UsersIcon } from '@heroicons/react/24/solid';
import styles from './DefaultAvatar.module.css';

export default function DefaultAvatar({ className = '', style = {}, isGroup = false, size }) {
  const sizeStyle = size ? { width: typeof size === 'number' ? `${size}px` : size, height: typeof size === 'number' ? `${size}px` : size } : {};

  return (
    <div
      className={`${styles.avatar} ${className}`}
      style={{
        background: 'transparent',
        borderRadius: isGroup ? '24%' : '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        ...sizeStyle,
        ...style
      }}
    >
      {isGroup ? (
        <div style={{ width: '100%', height: '100%', background: '#1d68f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <UsersIcon style={{ width: '60%', height: '60%', display: 'block', color: '#ffffff' }} />
        </div>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" style={{ width: '100%', height: '100%', display: 'block' }}>
          <circle cx="12" cy="12" r="12" fill="#1d68f7"/>
          <circle cx="12" cy="8.5" r="2.5" fill="#ffffff"/>
          <path fill="#ffffff" d="M7 16.3c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5c0 1.2-2.2 1.8-5 1.8s-5-0.6-5-1.8z"/>
        </svg>
      )}
    </div>
  );
}
