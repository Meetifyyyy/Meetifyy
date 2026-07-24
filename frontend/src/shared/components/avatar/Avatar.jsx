import { forwardRef, useState, useEffect } from 'react';
import { UsersIcon, UserIcon } from '@heroicons/react/24/solid';
import { useTheme } from '@shared/context/ThemeContext';
import defaultAvatarImg from '../../../assets/images/default_avatar.png';
import styles from './Avatar.module.css';

const isImageUrl = (str) => {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('/') || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:');
};

// Used only when showInitials=true (campus / directory pages)
const INITIALS_BG = '#7a8a9e';

export function getProcessedAvatarUrl(src) {
  if (!src || typeof src !== 'string' || src.includes('default_avatar')) {
    return null;
  }
  if (src.includes('api.dicebear.com/7.x/initials')) {
    return null;
  }

  // Rewrite localhost backend URLs to current network host when accessing from another device (e.g. mobile)
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      src = src.replace(/http:\/\/(?:localhost|127\.0\.0\.1):4000/g, `${window.location.protocol}//${host}:4000`);
    }
  }

  if (!src.startsWith('https://api.dicebear.com/')) {
    return src;
  }
  return src.split('&backgroundColor=')[0].split('?backgroundColor=')[0];
}

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
  const { theme } = useTheme();
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const processedSrc = getProcessedAvatarUrl(src, theme);

  useEffect(() => {
    setHasLoaded(false);
    setHasError(false);
  }, [processedSrc]);

  const sizeValue = typeof size === 'number' ? `${size}px` : size;
  const hasValidImageSrc = isImageUrl(processedSrc);
  const showImage = hasValidImageSrc && !hasError;

  // Initials mode for groups passed as short src string
  const isInitials = isGroup && src && typeof src === 'string' && src.length <= 2;
  const initials = isInitials ? src : '';

  // First-letter fallback — only when showInitials is explicitly requested
  const firstLetter = showInitials && !showImage && !isGroup && name
    ? name.trim()[0].toUpperCase()
    : null;

  const avatarStyle = {
    '--size': sizeValue,
    ...style
  };

  const clipStyle = !showImage && !firstLetter
    ? { background: 'var(--color-primary, #2563EB)', color: '#ffffff' }
    : firstLetter
      ? { background: INITIALS_BG }
      : (showImage && hasLoaded)
        ? { background: 'var(--color-bg-soft)' }
        : { background: 'var(--color-bg-white)' };

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
        style={clipStyle}
      >
        {showImage ? (
          <img
            src={processedSrc}
            alt={name || (isGroup ? 'Group Avatar' : 'User Avatar')}
            loading="lazy"
            className={styles.avatarImg}
            onLoad={() => setHasLoaded(true)}
            onError={() => setHasError(true)}
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
