import React, { useState, useEffect } from 'react';
import { ImageOff } from '@shared/components/icons';
import { mediaCache } from '../../utils/MediaCacheManager';

export default function OptimizedImage({ 
  src, 
  alt, 
  className = '', 
  fallbackSrc = null,
  skeletonClassName = 'bg-bg-tertiary animate-pulse',
  ...props 
}) {
  // Paint synchronously from the (possibly persisted) cache so stable public
  // assets show with zero network round-trip; refine async only if needed.
  const [imgSrc, setImgSrc] = useState(() => (src ? mediaCache.getSyncUrl(src) || '' : ''));
  const [status, setStatus] = useState('loading'); // 'loading', 'loaded', 'error'
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    if (!src) {
      setStatus('error');
      return;
    }

    // Immediate best-effort URL (cache hit or direct/public URL) — avoids the
    // async gap that previously delayed first paint on every mount.
    const sync = mediaCache.getSyncUrl(src);
    if (sync) setImgSrc(sync);

    const fetchUrl = async () => {
      try {
        const resolvedUrl = await mediaCache.getUrl(src);
        if (isMounted && resolvedUrl && resolvedUrl !== sync) {
          setImgSrc(resolvedUrl);
        } else if (isMounted && !resolvedUrl && !sync) {
          setStatus('error');
        }
      } catch (err) {
        if (isMounted && !sync) setStatus('error');
      }
    };

    fetchUrl();

    return () => {
      isMounted = false;
    };
  }, [src, retryCount]);

  const handleError = () => {
    // If the image failed to load, it might be an expired signed URL.
    // Invalidate the cache and retry once.
    if (retryCount === 0 && src) {
      mediaCache.invalidate(src);
      setRetryCount(1);
      return;
    }

    if (fallbackSrc && imgSrc !== fallbackSrc) {
      setImgSrc(fallbackSrc);
      // Still consider it loaded if we successfully fallback
    } else {
      setStatus('error');
    }
  };

  const handleLoad = () => {
    setStatus('loaded');
  };

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Skeleton / Placeholder */}
      {status === 'loading' && (
        <div className={`absolute inset-0 ${skeletonClassName}`} />
      )}
      
      {/* Error Fallback */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary text-text-muted">
          <ImageOff size={24} />
        </div>
      )}

      {/* Actual Image */}
      {imgSrc && status !== 'error' && (
        <img
          src={imgSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
          {...props}
        />
      )}
    </div>
  );
}
