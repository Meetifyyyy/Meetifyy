import { UsersIcon } from '@heroicons/react/24/solid';
import defaultAvatarImg from '../../../assets/images/default_avatar.webp';
import styles from './DefaultAvatar.module.css';

export default function DefaultAvatar({ className = '', style = {}, isGroup = false, size }) {
  const sizeStyle = size ? { width: typeof size === 'number' ? `${size}px` : size, height: typeof size === 'number' ? `${size}px` : size } : {};

  if (isGroup) {
    return (
      <div
        className={`${styles.avatar} ${className}`}
        style={{
          background: 'var(--color-primary, #2563EB)',
          color: '#ffffff',
          ...sizeStyle,
          ...style
        }}
      >
        <UsersIcon style={{ width: '60%', height: '60%', display: 'block', color: '#ffffff' }} />
      </div>
    );
  }

  return (
    <div
      className={`${styles.avatar} ${className}`}
      style={{
        background: 'transparent',
        borderRadius: '50%',
        overflow: 'hidden',
        ...sizeStyle,
        ...style
      }}
    >
      <img
        src={defaultAvatarImg}
        alt="Default avatar"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '50%' }}
      />
    </div>
  );
}
