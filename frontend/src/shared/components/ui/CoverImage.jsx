import { useState, useEffect, useRef } from 'react';
import defaultCover from '@assets/images/default_cover.webp';
import { getMediaUrl } from '@shared/api/apiClient';
import styles from './CoverImage.module.css';

export function getCleanCoverUrl(cover, fallback = defaultCover) {
  if (!cover || typeof cover !== 'string' || !cover.trim()) {
    return { isGradient: false, url: fallback };
  }
  const clean = cover.trim();
  if (clean.startsWith('linear-gradient') || clean.startsWith('radial-gradient') || clean.startsWith('conic-gradient')) {
    return { isGradient: true, gradient: clean };
  }
  if (clean.startsWith('data:image/') || clean.startsWith('blob:')) {
    return { isGradient: false, url: clean };
  }
  return { isGradient: false, url: getMediaUrl(clean) };
}

const loadedCoverCache = new Set();

export default function CoverImage({
  cover,
  fallback = defaultCover,
  alt = 'Cover photo',
  className = '',
  style = {},
  children
}) {
  const { isGradient, gradient, url } = getCleanCoverUrl(cover, fallback);
  const [error, setError] = useState(false);
  const imgRef = useRef(null);

  const activeUrl = (!error && url) ? url : fallback;

  const isPreloaded = isGradient || 
    loadedCoverCache.has(activeUrl) || 
    activeUrl === fallback || 
    (typeof activeUrl === 'string' && (activeUrl.startsWith('blob:') || activeUrl.startsWith('data:')));

  const [loading, setLoading] = useState(!isPreloaded);

  useEffect(() => {
    if (isGradient) {
      setLoading(false);
      setError(false);
      return;
    }
    const preloaded = loadedCoverCache.has(activeUrl) || 
      activeUrl === fallback || 
      (typeof activeUrl === 'string' && (activeUrl.startsWith('blob:') || activeUrl.startsWith('data:')));

    if (preloaded) {
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(false);
  }, [url, isGradient, activeUrl, fallback]);

  useEffect(() => {
    if (!isGradient && imgRef.current && imgRef.current.complete) {
      if (activeUrl) loadedCoverCache.add(activeUrl);
      setLoading(false);
    }
  }, [activeUrl, isGradient]);

  const handleLoad = () => {
    if (activeUrl) loadedCoverCache.add(activeUrl);
    setLoading(false);
  };

  const handleError = () => {
    setError(true);
    setLoading(false);
  };

  return (
    <div className={`${styles.coverWrap} ${className}`} style={style}>
      {loading && <div className={styles.coverSkeleton} />}
      
      {isGradient ? (
        <div className={styles.coverGradient} style={{ background: gradient }} />
      ) : (
        <img
          ref={imgRef}
          src={activeUrl}
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
