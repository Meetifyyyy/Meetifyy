import React, { useState, useEffect } from 'react';
import { ImageOff } from 'lucide-react';
import { getMediaUrl } from '../../api/apiClient';

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

  useEffect(() => {
    if (!src) {
      setStatus('error');
      return;
    }
    
    // Resolve the full CDN/Backend URL
    const resolvedUrl = getMediaUrl(src);
    setImgSrc(resolvedUrl);
    setStatus('loading');
  }, [src]);

  const handleError = () => {
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
