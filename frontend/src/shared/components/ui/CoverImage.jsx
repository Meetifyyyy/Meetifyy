import { useState, useEffect } from 'react';
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

export default function CoverImage({
  cover,
  fallback = defaultCover,
  alt = 'Cover photo',
  className = '',
  style = {},
  children
}) {
  const { isGradient, gradient, url } = getCleanCoverUrl(cover, fallback);
  const [loading, setLoading] = useState(!isGradient);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (isGradient) {
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
  }, [url, isGradient]);

  const activeUrl = (!error && url) ? url : fallback;

  return (
    <div className={`${styles.coverWrap} ${className}`} style={style}>
      {loading && <div className={styles.coverSkeleton} />}
      
      {isGradient ? (
        <div className={styles.coverGradient} style={{ background: gradient }} />
      ) : (
        <img
          src={activeUrl}
          alt={alt}
          className={`${styles.coverImg} ${loading ? styles.hidden : styles.visible}`}
          onLoad={() => setLoading(false)}
          onError={() => {
            setError(true);
            setLoading(false);
          }}
          draggable={false}
        />
      )}
      {children}
    </div>
  );
}
