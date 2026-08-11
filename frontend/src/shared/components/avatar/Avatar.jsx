import { forwardRef, useState, useEffect, useMemo } from 'react';
import { UsersIcon } from '@heroicons/react/24/solid';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { getMediaUrl, normalizeDicebearUrl, deriveThumbnailKey } from '@shared/api/apiClient';
import { useCanSeeOthersPresence } from '@shared/hooks/usePresenceVisibility';
import defaultAvatarImg from '../../../assets/images/default_avatar.webp';
import styles from './Avatar.module.css';

export function getProcessedAvatarUrl(src) {
  if (!src) return '/default_avatar.webp';
  let s = src;
  if (typeof s === 'object') {
    s = s.avatar || s.avatarUrl || s.url || s.objectKey || s.profileImage || (s.avatarMedia ? s.avatarMedia.objectKey : '') || '';
  }
  if (typeof s !== 'string' || !s.trim() || s.trim().length <= 2) {
    return '/default_avatar.webp';
  }
  const clean = s.trim();
  if (clean.includes('default_avatar') || clean.includes('api.dicebear.com/7.x/initials')) {
    return '/default_avatar.webp';
  }
  if (clean.includes('api.dicebear.com/')) {
    return normalizeDicebearUrl(clean);
  }
  // Convert /api/media/ relative paths to absolute backend URL so they work across environments
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
  const canSeePresence = useCanSeeOthersPresence();
  const initialProcessedSrc = getProcessedAvatarUrl(src);
  // Prefer a tiny derived thumbnail for the (usually small) avatar render; fall
  // back to the original on error, then to the default. `null` for external /
  // dicebear / default sources, which are already small.
  const thumbKey = useMemo(() => deriveThumbnailKey(initialProcessedSrc), [initialProcessedSrc]);
  const [useThumb, setUseThumb] = useState(!!thumbKey);
  const resolveSrc = (useThumb && thumbKey) ? thumbKey : initialProcessedSrc;

  const syncResolved = mediaCache.getSyncUrl(resolveSrc) || (
    (resolveSrc && resolveSrc !== defaultAvatarImg) ? getMediaUrl(resolveSrc) : null
  );

  const [imgSrc, setImgSrc] = useState(syncResolved || defaultAvatarImg);

  // Reset the thumbnail preference whenever the underlying avatar changes.
  useEffect(() => { setUseThumb(!!thumbKey); }, [thumbKey]);

  useEffect(() => {
    let isMounted = true;

    if (!initialProcessedSrc || initialProcessedSrc === defaultAvatarImg || (typeof initialProcessedSrc === 'string' && initialProcessedSrc.includes('default_avatar'))) {
      setImgSrc(defaultAvatarImg);
      return;
    }

    const currentSync = mediaCache.getSyncUrl(resolveSrc) || getMediaUrl(resolveSrc) || resolveSrc;
    setImgSrc(currentSync);

    const fetchUrl = async () => {
      try {
        const resolvedUrl = await mediaCache.getUrl(resolveSrc);
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
  }, [initialProcessedSrc, resolveSrc]);

  const sizeValue = typeof size === 'number' ? `${size}px` : size;
  const displaySrc = imgSrc || defaultAvatarImg;

  const avatarStyle = {
    '--size': sizeValue,
    ...style
  };

  const handleClick = (e) => {
    if (onClick) onClick(e);
  };
  
  const isBlobOrPreloaded = loadedAvatarCache.has(displaySrc) || 
    displaySrc === defaultAvatarImg || 
    (typeof displaySrc === 'string' && (displaySrc.startsWith('blob:') || displaySrc.startsWith('data:')));
  const [imgLoading, setImgLoading] = useState(!isBlobOrPreloaded);

  useEffect(() => {
    if (loadedAvatarCache.has(displaySrc) || displaySrc === defaultAvatarImg || (typeof displaySrc === 'string' && (displaySrc.startsWith('blob:') || displaySrc.startsWith('data:')))) {
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
    // First failure on the thumbnail variant → retry with the full original
    // (e.g. legacy avatars uploaded before thumbnails existed).
    if (useThumb && thumbKey) {
      mediaCache.invalidate(resolveSrc);
      setUseThumb(false);
      return;
    }
    if (initialProcessedSrc && initialProcessedSrc !== defaultAvatarImg) {
      mediaCache.invalidate(initialProcessedSrc);
    }
    setImgSrc(defaultAvatarImg);
    setImgLoading(false);
  };

  // Show the default group icon (UsersIcon) when the group has no custom avatar uploaded
  const isDefaultGroupAvatar = isGroup && (
    !src ||
    initialProcessedSrc === defaultAvatarImg ||
    imgSrc === defaultAvatarImg
  );

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

      {isOnline && !isGroup && canSeePresence && (
        <span className={styles.onlineDot} />
      )}
    </div>
  );
});

Avatar.displayName = 'Avatar';
export default Avatar;
