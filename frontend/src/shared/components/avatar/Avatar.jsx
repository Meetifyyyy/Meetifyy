import { forwardRef, useState, useEffect } from 'react';
import { UsersIcon } from '@heroicons/react/24/solid';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { getMediaUrl, normalizeDicebearUrl } from '@shared/api/apiClient';
import defaultAvatarImg from '../../../assets/images/default_avatar.webp';
import styles from './Avatar.module.css';

export function getProcessedAvatarUrl(src) {
  if (!src) return defaultAvatarImg;
  let s = src;
  if (typeof s === 'object') {
    s = s.avatar || s.avatarUrl || s.url || s.objectKey || s.profileImage || '';
  }
  if (typeof s !== 'string' || !s.trim() || s.trim().length <= 2) {
    return defaultAvatarImg;
  }
  const clean = s.trim();
  if (clean.includes('default_avatar') || clean.includes('api.dicebear.com/7.x/initials')) {
    return defaultAvatarImg;
  }
  if (clean.includes('api.dicebear.com/')) {
    return normalizeDicebearUrl(clean);
  }
  // Convert /api/media/ relative paths to absolute backend URL so they work on Vercel
  if (clean.startsWith('/api/media/') || (!clean.startsWith('http') && !clean.startsWith('data:') && !clean.startsWith('blob:') && !clean.startsWith('/'))) {
    return getMediaUrl(clean);
  }
  return clean;
}

const loadedAvatarCache = new Set();

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
  const syncResolved = mediaCache.getSyncUrl(initialProcessedSrc) || (
    (initialProcessedSrc && initialProcessedSrc !== defaultAvatarImg) ? initialProcessedSrc : null
  );

  const [imgSrc, setImgSrc] = useState(syncResolved || defaultAvatarImg);

  useEffect(() => {
    let isMounted = true;
    
    if (!initialProcessedSrc || initialProcessedSrc === defaultAvatarImg) {
      setImgSrc(defaultAvatarImg);
      return;
    }

    const currentSync = mediaCache.getSyncUrl(initialProcessedSrc) || initialProcessedSrc;
    setImgSrc(currentSync);

    const fetchUrl = async () => {
      try {
        const resolvedUrl = await mediaCache.getUrl(initialProcessedSrc);
        if (isMounted && resolvedUrl) {
          setImgSrc(resolvedUrl);
        }
      } catch (err) {
        // Keep currentSync fallback on error
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
  
  const isPreloaded = loadedAvatarCache.has(displaySrc) || displaySrc === defaultAvatarImg;
  const [imgLoading, setImgLoading] = useState(!isPreloaded);

  useEffect(() => {
    if (loadedAvatarCache.has(displaySrc) || displaySrc === defaultAvatarImg) {
      setImgLoading(false);
    } else {
      setImgLoading(true);
    }
  }, [displaySrc]);

  const handleLoad = () => {
    if (displaySrc) loadedAvatarCache.add(displaySrc);
    setImgLoading(false);
  };

  const handleError = () => {
    if (initialProcessedSrc && initialProcessedSrc !== defaultAvatarImg) {
      mediaCache.invalidate(initialProcessedSrc);
    }
    setImgSrc(defaultAvatarImg);
    setImgLoading(false);
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
        <div className={styles.avatarClip}>
          {imgLoading && (
            <div className={styles.avatarSkeleton} />
          )}
          <img
            src={displaySrc}
            alt={name || 'Avatar'}
            loading="lazy"
            decoding="async"
            className={`${styles.avatarImg} ${imgLoading ? styles.imgHidden : styles.imgVisible}`}
            onLoad={handleLoad}
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
