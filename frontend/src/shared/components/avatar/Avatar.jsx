import { forwardRef, useState, useEffect } from 'react';
import { UsersIcon, UserIcon } from '@heroicons/react/24/solid';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import defaultAvatarImg from '../../../assets/images/default_avatar.webp';
import styles from './Avatar.module.css';

const isImageUrl = (str) => {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('/') || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:') || str.startsWith('blob:');
};

// Used only when showInitials=true (campus / directory pages)
const INITIALS_BG = '#7a8a9e';

export function getProcessedAvatarUrl(src) {
  if (!src || typeof src !== 'string' || src.length <= 2 || src.includes('default_avatar')) {
    return null;
  }
  if (src.includes('api.dicebear.com/7.x/initials')) {
    return null;
  }
  
  if (src.startsWith('https://api.dicebear.com/')) {
    return src.split('&backgroundColor=')[0].split('?backgroundColor=')[0];
  }
  
  return src; // Let MediaCacheManager handle the resolution
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
  const [imgSrc, setImgSrc] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const initialProcessedSrc = getProcessedAvatarUrl(src);

  useEffect(() => {
    let isMounted = true;
    
    setHasLoaded(false);
    setHasError(false);

    if (!initialProcessedSrc) {
      setImgSrc(null);
      return;
    }

    const fetchUrl = async () => {
      try {
        const resolvedUrl = await mediaCache.getUrl(initialProcessedSrc);
        if (isMounted) {
          if (resolvedUrl) {
            setImgSrc(resolvedUrl);
          } else {
            setHasError(true);
          }
        }
      } catch (err) {
        if (isMounted) setHasError(true);
      }
    };
    
    fetchUrl();

    return () => {
      isMounted = false;
    };
  }, [initialProcessedSrc, retryCount]);

  const sizeValue = typeof size === 'number' ? `${size}px` : size;
  const hasValidImageSrc = isImageUrl(imgSrc);
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
  
  const handleError = () => {
    if (retryCount === 0 && initialProcessedSrc) {
      mediaCache.invalidate(initialProcessedSrc);
      setRetryCount(1);
      return;
    }
    setHasError(true);
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
            src={imgSrc}
            alt={name || (isGroup ? 'Group Avatar' : 'User Avatar')}
            loading="lazy"
            decoding="async"
            className={styles.avatarImg}
            onLoad={() => setHasLoaded(true)}
            onError={handleError}
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
