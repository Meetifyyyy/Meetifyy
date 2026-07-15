import { forwardRef } from 'react';
import { UsersIcon, UserIcon } from '@heroicons/react/24/solid';
import styles from './Avatar.module.css';

const isImageUrl = (str) => {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('/') || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:');
};

// Used only when showInitials=true (campus / directory pages)
const INITIALS_BG = '#7a8a9e';

const Avatar = forwardRef(({
  src,
  name = '',
  size = '40px',
  isGroup = false,
  isOnline = false,
  showInitials = false,   // only enable for campus "you may know" & directory
  className = '',
  style = {},
  onClick,
  disableHover = false,
  children
}, ref) => {
  const sizeValue = typeof size === 'number' ? `${size}px` : size;
  const hasImage = isImageUrl(src);

  // Initials mode for groups passed as short src string
  const isInitials = isGroup && src && typeof src === 'string' && src.length <= 2;
  const initials = isInitials ? src : '';

  // First-letter fallback — only when showInitials is explicitly requested
  const firstLetter = showInitials && !hasImage && !isGroup && name
    ? name.trim()[0].toUpperCase()
    : null;

  const avatarStyle = {
    '--size': sizeValue,
    ...style
  };

  const handleClick = (e) => {
    if (onClick) onClick(e);
  };

  return (
    <div
      ref={ref}
      className={`${styles.avatarContainer} ${isGroup ? styles.avatarGroup : styles.avatarUser} ${(onClick && !disableHover) ? styles.clickable : ''} ${className}`}
      style={avatarStyle}
      onClick={handleClick}
    >
      <div
        className={styles.avatarClip}
        style={firstLetter ? { background: INITIALS_BG } : undefined}
      >
        {hasImage ? (
          <img
            src={src}
            alt={name || (isGroup ? 'Group Avatar' : 'User Avatar')}
            loading="lazy"
            className={styles.avatarImg}
          />
        ) : isInitials ? (
          <div className={styles.avatarInitials}>{initials}</div>
        ) : firstLetter ? (
          <div className={styles.avatarInitials}>{firstLetter}</div>
        ) : isGroup ? (
          <UsersIcon className={styles.avatarIcon} />
        ) : (
          <UserIcon className={styles.avatarIcon} />
        )}
        {children}
      </div>

      {isOnline && !isGroup && (
        <span className={styles.onlineDot} />
      )}
    </div>
  );
});

Avatar.displayName = 'Avatar';
export default Avatar;
