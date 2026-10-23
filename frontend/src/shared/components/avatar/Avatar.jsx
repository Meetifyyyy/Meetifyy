import { forwardRef, useState, useMemo } from 'react';
import { UsersIcon } from '@heroicons/react/24/solid';
import { getMediaUrl, normalizeDicebearUrl, deriveThumbnailKey } from '@shared/api/apiClient';
import { isDicebearUrl, directPublicMediaUrl } from '@core/api/media';
import { config } from '@config';
import { useCanSeeOthersPresence } from '@shared/hooks/usePresenceVisibility';
import { DEFAULT_AVATAR_SRC, isPlatformDefaultAvatar } from '@shared/constants/defaultAvatar';
import { noteImageStart, isImageComplete, loadedQuickly } from '@shared/utils/imageReveal';
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
  if (isDicebearUrl(clean)) {
    return normalizeDicebearUrl(clean);
  }
  return getMediaUrl(clean);
}

/**
 * Where to load an uploaded avatar from first.
 *
 * `/api/media/<key>` answers an avatar with a 302 to the public media host, so
 * every avatar cost an API round trip before the image request even started.
 * Avatars are public by construction, so the address can be built here without
 * asking. Anything that is not an allowlisted public key — and everything when
 * no public host is configured — keeps the API URL. The API URL stays the
 * fallback: `handleError` retries it if the direct load fails.
 */
export function directAvatarUrl(apiUrl) {
  return directPublicMediaUrl(apiUrl, config.storage?.publicUrl) || null;
}

/**
 * Thumbnails the public host did not have. Older uploads have none, and the
 * API used to cover that with a redirect to the original; going direct, the
 * miss is a 404, so it is remembered for the session instead of being paid
 * again on every render of that person.
 */
const missingThumbCache = new Set();

/**
 * The largest avatar the 160px thumbnail serves sharply on a 3x screen
 * (160 / 3 ≈ 53), rounded down to the largest common list size. Bigger
 * avatars — profile headers, invite panels — keep the original.
 */
const THUMBNAIL_MAX_PX = 48;

/** True for a fixed size (a number, or `NNpx`) small enough for the thumbnail. */
function isSmallFixedSize(size) {
  const px = typeof size === 'number'
    ? size
    : /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(String(size))?.[1];
  return px != null && Number(px) <= THUMBNAIL_MAX_PX;
}

const loadedAvatarCache = new Set();
const failedAvatarCache = new Set();

/** Nothing to wait for: seen before this session, or inline data. */
const startsLoaded = (src) =>
  loadedAvatarCache.has(src) || src.startsWith('blob:') || src.startsWith('data:');

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
   * Use the `<key>_thumb.webp` variant of an uploaded avatar.
   *
   * Automatic when the rendered size is fixed and at most 48px — which is
   * nearly every avatar in the app (feed, comments, chat, lists paint 28–48px).
   * It used to be opt-in and only one of ~50 callers opted in, so a 32px avatar
   * downloaded and decoded the 512px original, for every distinct person on
   * screen. Pass `thumbnail` explicitly to override either way. The thumbnail is generated at 160px, which still covers a
   * 3x phone. `/api/media/<key>_thumb.webp` redirects to the original when no
   * thumbnail was produced (older uploads), so this can only ever be the same
   * bytes or fewer — and the `onError` chain below re-tries the original
   * anyway if the variant somehow does not resolve.
   *
   * Not for large avatars: above ~160px rendered, the thumbnail is the smaller
   * image and would visibly soften.
   */
  thumbnail,
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
  // The API address. The failure caches are keyed on it — one identity per
  // avatar, whichever address ends up serving it.
  const fullSrc = useMemo(() => getProcessedAvatarUrl(src), [src]);
  const directFullSrc = useMemo(() => directAvatarUrl(fullSrc), [fullSrc]);
  const firstFullSrc = directFullSrc || fullSrc;
  // Null for anything not stored as one of our media keys — a dicebear URL or
  // the bundled default has no variant to ask for.
  const useThumbnail = thumbnail ?? isSmallFixedSize(size);
  const thumbSrc = useMemo(() => {
    if (!useThumbnail) return null;
    const key = deriveThumbnailKey(fullSrc);
    if (!key) return null;
    const apiThumb = getMediaUrl(key);
    const direct = directAvatarUrl(apiThumb);
    if (!direct) return apiThumb;
    return missingThumbCache.has(direct) ? null : direct;
  }, [useThumbnail, fullSrc]);
  const initialProcessedSrc = thumbSrc || firstFullSrc;

  // Keyed on the original, never the thumbnail: a variant that fails to load
  // says nothing about whether the account has a picture, and caching the
  // failure under the thumbnail's URL would send the next render to the
  // default glyph instead of to the original.
  const hasCustomAvatar = Boolean(
    fullSrc &&
    typeof fullSrc === 'string' &&
    fullSrc.trim() &&
    !isPlatformDefaultAvatar(fullSrc) &&
    !failedAvatarCache.has(fullSrc)
  );

  const [hasError, setHasError] = useState(() => failedAvatarCache.has(fullSrc));
  const [imgSrc, setImgSrc] = useState(initialProcessedSrc);
  const [imgLoading, setImgLoading] = useState(() => !startsLoaded(initialProcessedSrc));
  // The picture came from the cache a frame after it mounted: show it at once
  // instead of fading it in over a skeleton (see shared/utils/imageReveal).
  const [revealInstantly, setRevealInstantly] = useState(false);

  // A different picture starts over. Adjusted during render rather than in an
  // effect: an effect also runs after the FIRST render, where it would undo a
  // cached picture the image's ref had just shown, and put its skeleton back
  // for the frame the `load` event takes to arrive.
  const sourceKey = `${fullSrc}\n${initialProcessedSrc}`;
  const [seenSourceKey, setSeenSourceKey] = useState(sourceKey);
  if (seenSourceKey !== sourceKey) {
    setSeenSourceKey(sourceKey);
    if (failedAvatarCache.has(fullSrc)) {
      setHasError(true);
      setImgLoading(false);
    } else {
      setHasError(false);
      setImgSrc(initialProcessedSrc);
      setRevealInstantly(false);
      setImgLoading(!startsLoaded(initialProcessedSrc));
    }
  }

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

  const handleLoad = (e) => {
    if (imgSrc) loadedAvatarCache.add(imgSrc);
    setRevealInstantly(loadedQuickly(e?.currentTarget));
    setImgLoading(false);
  };

  // The session's "loaded" set is empty after a restart, but the WebView's own
  // cache is not: a cached picture is already complete here (or a frame from
  // it), and must not wait for its `load` event to be shown.
  const attachImage = (img) => {
    if (!img) return;
    noteImageStart(img);
    if (imgLoading && isImageComplete(img)) handleLoad({ currentTarget: img });
  };

  const handleError = () => {
    // A thumbnail that does not resolve is not a missing avatar — retry the
    // original once before giving up on the picture entirely.
    if (thumbSrc && imgSrc === thumbSrc && firstFullSrc && firstFullSrc !== thumbSrc) {
      // Not while offline: that failure says nothing about the file, and
      // remembering it would load the full-size image all session.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (!thumbSrc.includes('/api/media/') && !offline) missingThumbCache.add(thumbSrc);
      setImgSrc(firstFullSrc);
      return;
    }
    // The public host missed — an unconfigured local backend serving from
    // disk, or an object only the API can resolve. The API URL is the
    // authority; try it once before drawing the default.
    if (directFullSrc && imgSrc === directFullSrc && fullSrc !== directFullSrc) {
      setImgSrc(fullSrc);
      return;
    }
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
          <div className={`${styles.avatarSkeleton} ${styles.avatarSkeletonHeld}`} />
        )}
        <img
          ref={attachImage}
          src={imgSrc}
          alt={name || 'Avatar'}
          loading="lazy"
          decoding="async"
          className={`${styles.avatarImg} ${imgLoading ? styles.imgHidden : styles.imgVisible} ${revealInstantly ? styles.imgInstant : ''}`}
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
