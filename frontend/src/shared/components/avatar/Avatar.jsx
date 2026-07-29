import { forwardRef, useState, useEffect } from 'react';
import { UsersIcon } from '@heroicons/react/24/solid';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { getMediaUrl } from '@shared/api/apiClient';
import defaultAvatarImg from '../../../assets/images/default_avatar.webp';
import styles from './Avatar.module.css';

const isImageUrl = (str) => {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim().toLowerCase();
  return (
    s.startsWith('/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('data:') ||
    s.startsWith('blob:') ||
    s.startsWith('src/') ||
    s.startsWith('assets/') ||
    s.includes('default_avatar') ||
    s.endsWith('.webp') ||
    s.endsWith('.png') ||
    s.endsWith('.jpg') ||
    s.endsWith('.jpeg') ||
    s.endsWith('.svg') ||
    s.endsWith('.gif')
  );
};

// Used only when showInitials=true (campus / directory pages)
const INITIALS_BG = 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)';

export function getProcessedAvatarUrl(src) {
  if (!src) return defaultAvatarImg;
  let s = src;
  if (typeof s === 'object') {
    s = s.avatarUrl || s.avatar || s.url || s.objectKey || s.profileImage || '';
  }
  if (typeof s !== 'string' || !s.trim() || s.trim().length <= 2) {
    return defaultAvatarImg;
  }
  const clean = s.trim();
  if (clean.includes('default_avatar') || clean.includes('api.dicebear.com/7.x/initials')) {
    return defaultAvatarImg;
  }
  if (clean.startsWith('https://api.dicebear.com/')) {
    return clean.split('&backgroundColor=')[0].split('?backgroundColor=')[0];
  }
  // Convert /api/media/ relative paths to absolute backend URL so they work on Vercel
  if (clean.startsWith('/api/media/') || (!clean.startsWith('http') && !clean.startsWith('data:') && !clean.startsWith('blob:') && !clean.startsWith('/'))) {
    return getMediaUrl(clean);
  }
  return clean;
}

const Avatar = forwardRef(({
  src,
  name = '',
  size = '40px',
  isGroup = false,
  isOnline = false,
  className = '',
  style = {},
  onClick,
  disableHover = false,
  children
}, ref) => {
  const initialProcessedSrc = getProcessedAvatarUrl(src);
  // getSyncUrl handles caching; for absolute/external URLs just use directly
  const syncResolved = mediaCache.getSyncUrl(initialProcessedSrc) || (
    initialProcessedSrc && (
      initialProcessedSrc.startsWith('https://') ||
      initialProcessedSrc.startsWith('data:') ||
      initialProcessedSrc.startsWith('blob:') ||
      initialProcessedSrc.includes('default_avatar')
    ) ? initialProcessedSrc : null
  );

  const [imgSrc, setImgSrc] = useState(syncResolved || defaultAvatarImg);

  useEffect(() => {
    let isMounted = true;
    
    if (!initialProcessedSrc || initialProcessedSrc === defaultAvatarImg) {
      setImgSrc(defaultAvatarImg);
      return;
    }

    const currentSync = mediaCache.getSyncUrl(initialProcessedSrc);
    if (currentSync) {
      setImgSrc(currentSync);
      return;
    }

    const fetchUrl = async () => {
      try {
        const resolvedUrl = await mediaCache.getUrl(initialProcessedSrc);
        if (isMounted) {
          setImgSrc(resolvedUrl || defaultAvatarImg);
        }
      } catch (err) {
        if (isMounted) {
          setImgSrc(defaultAvatarImg);
        }
      }
    };
    
    fetchUrl();

    return () => {
      isMounted = false;
    };
  }, [initialProcessedSrc]);

  const sizeValue = typeof size === 'number' ? `${size}px` : size;
  const displaySrc = imgSrc || defaultAvatarImg;

  const avatarStyle = {
    '--size': sizeValue,
    ...style
  };

  const handleClick = (e) => {
    if (onClick) onClick(e);
  };
  
  const handleError = () => {
    if (initialProcessedSrc && initialProcessedSrc !== defaultAvatarImg) {
      mediaCache.invalidate(initialProcessedSrc);
    }
    setImgSrc(defaultAvatarImg);
  };

  const isDefaultGroupAvatar = isGroup && (!imgSrc || imgSrc === defaultAvatarImg || !initialProcessedSrc || initialProcessedSrc === defaultAvatarImg);

  return (
    <div
      ref={ref}
      className={`${styles.avatarContainer} ${isGroup ? styles.avatarGroup : styles.avatarUser} ${(onClick && !disableHover) ? styles.clickable : ''} ${className}`}
      style={avatarStyle}
      onClick={handleClick}
    >
      {isDefaultGroupAvatar ? (
        <div
          className={styles.avatarClip}
          style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', color: '#ffffff' }}
        >
          <UsersIcon className={styles.avatarIcon} />
          {children}
        </div>
      ) : (
        <div
          className={styles.avatarClip}
          style={{ background: 'transparent' }}
        >
          <img
            src={displaySrc}
            alt={name || 'Avatar'}
            loading="lazy"
            decoding="async"
            className={styles.avatarImg}
            onError={handleError}
          />
          {children}
        </div>
      )}

      {isOnline && !isGroup && (
        <span className={styles.onlineDot} />
      )}
    </div>
  );
});

Avatar.displayName = 'Avatar';
export default Avatar;
