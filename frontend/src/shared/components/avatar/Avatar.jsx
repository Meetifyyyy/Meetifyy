import { forwardRef, useState, useEffect, useMemo } from 'react';
import { UsersIcon } from '@heroicons/react/24/solid';
import { getMediaUrl, normalizeDicebearUrl } from '@shared/api/apiClient';
import { useCanSeeOthersPresence } from '@shared/hooks/usePresenceVisibility';
import styles from './Avatar.module.css';

export function getProcessedAvatarUrl(src) {
  if (!src) return '/default_avatar.svg';
  let s = src;
  if (typeof s === 'object') {
    s = s.avatar || s.avatarUrl || s.url || s.objectKey || s.profileImage || (s.avatarMedia ? s.avatarMedia.objectKey : '') || '';
  }
  if (typeof s !== 'string' || !s.trim() || s.trim().length <= 2) {
    return '/default_avatar.svg';
  }
  const clean = s.trim();
  if (clean.includes('default_avatar') || clean.includes('api.dicebear.com/7.x/initials')) {
    return '/default_avatar.svg';
  }
  if (clean.includes('api.dicebear.com/')) {
    return normalizeDicebearUrl(clean);
  }
  return getMediaUrl(clean);
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
  isLoading = false,
  children
}, ref) => {
  const canSeePresence = useCanSeeOthersPresence();
  const initialProcessedSrc = useMemo(() => getProcessedAvatarUrl(src), [src]);

  const hasCustomAvatar = Boolean(
    initialProcessedSrc &&
    typeof initialProcessedSrc === 'string' &&
    initialProcessedSrc.trim() &&
    !initialProcessedSrc.includes('default_avatar')
  );

  const [hasError, setHasError] = useState(false);
  const [imgSrc, setImgSrc] = useState(initialProcessedSrc);
  const [imgLoading, setImgLoading] = useState(!loadedAvatarCache.has(initialProcessedSrc));

  useEffect(() => {
    setHasError(false);
    setImgSrc(initialProcessedSrc);
    if (loadedAvatarCache.has(initialProcessedSrc) || initialProcessedSrc.startsWith('blob:') || initialProcessedSrc.startsWith('data:')) {
      setImgLoading(false);
    } else {
      setImgLoading(true);
    }
  }, [initialProcessedSrc]);

  const sizeValue = typeof size === 'number' ? `${size}px` : size;
  const avatarStyle = {
    '--size': sizeValue,
    ...style
  };

  const handleClick = (e) => {
    if (onClick) onClick(e);
  };

  // Render shimmering skeleton if parent indicates loading
  if (isLoading) {
    return (
      <div
        ref={ref}
        className={`${styles.avatarContainer} ${isGroup ? styles.avatarGroup : styles.avatarUser} ${className}`}
        style={avatarStyle}
      >
        <div className={styles.avatarClip}>
          <div className={styles.avatarSkeleton} />
        </div>
      </div>
    );
  }

  if (!hasCustomAvatar || hasError) {
    return (
      <div
        ref={ref}
        className={`${styles.avatarContainer} ${isGroup ? styles.avatarGroup : styles.avatarUser} ${(onClick && !disableHover) ? styles.clickable : ''} ${className}`}
        style={avatarStyle}
        onClick={handleClick}
      >
        <div
          className={styles.avatarClip}
          style={{ background: 'transparent' }}
        >
          {isGroup ? (
            <div style={{ width: '100%', height: '100%', background: '#1d68f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UsersIcon className={styles.avatarIcon} style={{ color: '#ffffff' }} />
            </div>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" style={{ width: '100%', height: '100%', display: 'block' }}>
              <circle cx="12" cy="12" r="12" fill="#1d68f7"/>
              <circle cx="12" cy="8.5" r="2.5" fill="#ffffff"/>
              <path fill="#ffffff" d="M7 16.3c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5c0 1.2-2.2 1.8-5 1.8s-5-0.6-5-1.8z"/>
            </svg>
          )}
          {children}
        </div>
        {isOnline && !isGroup && canSeePresence && (
          <span className={styles.onlineDot} />
        )}
      </div>
    );
  }

  const handleLoad = () => {
    if (imgSrc) loadedAvatarCache.add(imgSrc);
    setImgLoading(false);
  };

  const handleError = () => {
    setHasError(true);
    setImgLoading(false);
  };

  return (
    <div
      ref={ref}
      className={`${styles.avatarContainer} ${isGroup ? styles.avatarGroup : styles.avatarUser} ${(onClick && !disableHover) ? styles.clickable : ''} ${className}`}
      style={avatarStyle}
      onClick={handleClick}
    >
      <div className={styles.avatarClip}>
        {imgLoading && (
          <div className={styles.avatarSkeleton} />
        )}
        <img
          src={imgSrc}
          alt={name || 'Avatar'}
          loading="lazy"
          decoding="async"
          className={`${styles.avatarImg} ${imgLoading ? styles.imgHidden : styles.imgVisible}`}
          onLoad={handleLoad}
          onError={handleError}
        />
        {children}
      </div>

      {isOnline && !isGroup && canSeePresence && (
        <span className={styles.onlineDot} />
      )}
    </div>
  );
});

Avatar.displayName = 'Avatar';
export default Avatar;
