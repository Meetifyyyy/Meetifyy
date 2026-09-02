import { forwardRef, useState, useEffect, useMemo } from 'react';
import { UsersIcon } from '@heroicons/react/24/solid';
import { getMediaUrl, normalizeDicebearUrl } from '@shared/api/apiClient';
import { useCanSeeOthersPresence } from '@shared/hooks/usePresenceVisibility';
import { DEFAULT_AVATAR_SRC, isPlatformDefaultAvatar } from '@shared/constants/defaultAvatar';
import styles from './Avatar.module.css';
import DefaultAvatarGlyph from './DefaultAvatarGlyph';

export function getProcessedAvatarUrl(src) {
  if (!src) return DEFAULT_AVATAR_SRC;
  let s = src;
  if (typeof s === 'object') {
    s = s.avatar || s.avatarUrl || s.url || s.objectKey || s.profileImage || (s.avatarMedia ? s.avatarMedia.objectKey : '') || '';
  }
  if (typeof s !== 'string' || !s.trim() || s.trim().length <= 2) {
    return DEFAULT_AVATAR_SRC;
  }
  const clean = s.trim();
  // Covers the server-side default reference too, so an account that never
  // chose a picture draws the default here instead of fetching it.
  if (isPlatformDefaultAvatar(clean)) {
    return DEFAULT_AVATAR_SRC;
  }
  if (clean.includes('api.dicebear.com/')) {
    return normalizeDicebearUrl(clean);
  }
  return getMediaUrl(clean);
}

const loadedAvatarCache = new Set();
const failedAvatarCache = new Set();

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
  /**
   * Notified when the picture fails to load.
   *
   * This component's own fallback is `/default_avatar.svg`, a person, and that
   * is right for a person and wrong for anything else: a group whose avatar
   * 404s rendered as an anonymous human. Rather than teach this component every
   * entity type's fallback, callers that have one of their own can be told the
   * load failed and draw it themselves. Purely additive; the built-in fallback
   * still applies to everyone who does not pass this.
   */
  onError,
  children
}, ref) => {
  const canSeePresence = useCanSeeOthersPresence();
  const initialProcessedSrc = useMemo(() => getProcessedAvatarUrl(src), [src]);

  const hasCustomAvatar = Boolean(
    initialProcessedSrc &&
    typeof initialProcessedSrc === 'string' &&
    initialProcessedSrc.trim() &&
    !isPlatformDefaultAvatar(initialProcessedSrc) &&
    !failedAvatarCache.has(initialProcessedSrc)
  );

  const [hasError, setHasError] = useState(() => failedAvatarCache.has(initialProcessedSrc));
  const [imgSrc, setImgSrc] = useState(initialProcessedSrc);
  const [imgLoading, setImgLoading] = useState(!loadedAvatarCache.has(initialProcessedSrc));

  useEffect(() => {
    if (failedAvatarCache.has(initialProcessedSrc)) {
      setHasError(true);
      setImgLoading(false);
      return;
    }

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
            <DefaultAvatarGlyph />
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
    if (imgSrc) failedAvatarCache.add(imgSrc);
    setHasError(true);
    setImgLoading(false);
    onError?.();
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
