import { UsersIcon } from '@heroicons/react/24/solid';
import styles from './DefaultAvatar.module.css';
import DefaultAvatarGlyph from './DefaultAvatarGlyph';

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
        <DefaultAvatarGlyph />
      )}
    </div>
  );
}
