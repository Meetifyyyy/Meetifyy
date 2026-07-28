import React, { useState, useEffect } from 'react';
import { ImageOff } from 'lucide-react';
import { mediaCache } from '../../utils/MediaCacheManager';

export default function OptimizedImage({ 
  src, 
  alt, 
  className = '', 
  fallbackSrc = null,
  skeletonClassName = 'bg-bg-tertiary animate-pulse',
  ...props 
}) {
  const [imgSrc, setImgSrc] = useState('');
  const [status, setStatus] = useState('loading'); // 'loading', 'loaded', 'error'
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const fetchUrl = async () => {
      if (!src) {
        if (isMounted) setStatus('error');
        return;
      }
      
      if (isMounted) setStatus('loading');
      
      try {
        const resolvedUrl = await mediaCache.getUrl(src);
        if (isMounted) {
          if (resolvedUrl) {
            setImgSrc(resolvedUrl);
          } else {
            setStatus('error');
          }
        }
      } catch (err) {
        if (isMounted) setStatus('error');
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
