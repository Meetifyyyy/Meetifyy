import { useState, useEffect, useRef } from 'react';
import { getMediaUrl } from '@shared/api/apiClient';
import styles from './CoverImage.module.css';

/**
 * Resolves a stored cover value into either a gradient descriptor, a URL, or
 * an "empty" signal when nothing has been uploaded.
 *
 * Empty covers render as a subtle `var(--empty-cover-gradient)` area — theme-aware
 * (#F1F3F5 light / #202225 dark) — with no image request at all.
 */
export function getCleanCoverUrl(cover) {
  if (!cover || typeof cover !== 'string' || !cover.trim()) {
    return { isEmpty: true };
  }
  const clean = cover.trim();
  // Strip out old platform-default keys that were written to the DB before
  // this system was removed — treat them the same as null/empty.
  if (clean.includes('/api/media/defaults/')) {
    return { isEmpty: true };
  }
  if (clean.startsWith('linear-gradient') || clean.startsWith('radial-gradient') || clean.startsWith('conic-gradient')) {
    return { isGradient: true, gradient: clean };
  }
  if (clean.startsWith('data:image/') || clean.startsWith('blob:')) {
    return { isEmpty: false, url: clean };
  }
  return { isEmpty: false, url: getMediaUrl(clean) };
}

const loadedCoverCache = new Set();

export default function CoverImage({
  cover,
  alt = 'Cover photo',
  className = '',
  style = {},
  children
}) {
  const resolved = getCleanCoverUrl(cover);
  const [error, setError] = useState(false);
  const imgRef = useRef(null);

  const isEmpty = resolved.isEmpty || error;
  const isGradient = !isEmpty && resolved.isGradient;
  const url = (!isEmpty && !isGradient) ? resolved.url : null;

  const isPreloaded = isEmpty || isGradient ||
    (url && loadedCoverCache.has(url)) ||
    (url && (url.startsWith('blob:') || url.startsWith('data:')));

  const [loading, setLoading] = useState(!isPreloaded);

  useEffect(() => {
    if (isEmpty || isGradient) {
      setLoading(false);
      setError(false);
      return;
    }
    setError(false);
    const preloaded = url && (
      loadedCoverCache.has(url) ||
      url.startsWith('blob:') ||
      url.startsWith('data:')
    );
    setLoading(!preloaded);
  }, [cover]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isEmpty && !isGradient && imgRef.current && imgRef.current.complete) {
      if (url) loadedCoverCache.add(url);
      setLoading(false);
    }
  }, [url, isEmpty, isGradient]);

  const handleLoad = () => {
    if (url) loadedCoverCache.add(url);
    setLoading(false);
  };

  const handleError = () => {
    setError(true);
    setLoading(false);
  };

  return (
    <div className={`${styles.coverWrap} ${className}`} style={style}>
      {loading && <div className={styles.coverSkeleton} />}

      {isEmpty ? (
        <div className={styles.coverEmpty} />
      ) : isGradient ? (
        <div className={styles.coverGradient} style={{ background: resolved.gradient }} />
      ) : (
        <img
          ref={imgRef}
          src={url}
          alt={alt}
          className={`${styles.coverImg} ${loading ? styles.hidden : styles.visible}`}
          onLoad={handleLoad}
          onError={handleError}
          draggable={false}
        />
      )}
      {children}
    </div>
  );
}
