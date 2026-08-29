import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './ImageSearchModal.module.css';
import { X, Upload, Loader2 } from '@shared/components/icons';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  ALLOWED_IMAGE_ACCEPT,
} from '@shared/constants/mediaLimits';
import { compressAndCacheDraftImage } from '@shared/utils/draftImageCache';
import MediaCropper from '@shared/components/media/MediaCropper';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { showToast } from '@shared/utils/toast';
import { PRESET_IMAGES, PRESET_GIFS } from '@shared/constants/presetMedia';

/**
 * Detects constrained/low-memory environments conservatively as progressive enhancement.
 */
function checkIsLowMemory() {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof navigator !== 'undefined') {
      if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return true;
      if (navigator.connection && (navigator.connection.saveData || /2g|slow-2g/i.test(navigator.connection.effectiveType))) return true;
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  } catch (_) {}
  return false;
}

/**
 * Viewport-aware, memory-optimized grid item.
 * - For images: loads 360px WebP thumbnails. Top items get fetchpriority="high".
 * - For GIFs: renders static poster frame; activates animated GIF only when in viewport
 *   (or on hover/focus on low-memory devices) and reverts to poster when scrolled away.
 */
const MediaGridItem = memo(function MediaGridItem({
  item,
  isGif,
  priority,
  isLowMemory,
  onSelect,
  observerRootRef,
}) {
  const itemRef = useRef(null);
  const [isInView, setIsInView] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const el = itemRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setIsInView(entry.isIntersecting);
        }
      },
      {
        root: observerRootRef.current,
        rootMargin: '100px',
        threshold: 0.05,
      },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [observerRootRef]);

  const handleClick = useCallback(() => {
    onSelect(item.url);
  }, [item.url, onSelect]);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  let srcUrl;
  if (!isGif) {
    srcUrl = item.thumbUrl || item.url;
  } else {
    // For GIFs:
    // On standard devices: animate when in viewport or hovered.
    // On low-memory devices: show static poster until hovered/touched/focused.
    const shouldAnimate = isLowMemory ? isHovered : (isInView || isHovered);
    srcUrl = shouldAnimate && !hasError ? item.url : (item.posterUrl || item.url);
  }

  return (
    <button
      ref={itemRef}
      type="button"
      className={styles.isResultBtn}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      aria-label={item.title}
    >
      <img
        src={srcUrl}
        alt={item.title}
        width={item.width || 360}
        height={item.height || 360}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchpriority={priority ? 'high' : 'auto'}
        onError={handleError}
      />
    </button>
  );
});

/**
 * `theme` re-applies a colour scope to the portalled content. Portalling to
 * <body> escapes any `data-theme` wrapper at the call site, so a caller that
 * forces its own scheme (e.g. the always-dark Create Activity page) must say so
 * explicitly or the modal would render with the app's default tokens.
 */
export default function ImageSearchModal({ onClose, onSelect, theme }) {
  const [isCompressingRemote, setIsCompressingRemote] = useState(false);
  const [activeTab, setActiveTab] = useState('images'); // 'images' or 'gifs'
  const [cropTarget, setCropTarget] = useState(null);
  const [isLowMemory] = useState(checkIsLowMemory);
  const fileInputRef = useRef(null);
  const bodyScrollRef = useRef(null);

  // Only the most recent selection may call onSelect.
  const selectionTokenRef = useRef(0);
  const isCurrent = (token) => token === selectionTokenRef.current;

  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(true, onClose);
  useScrollLock(true);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleCustomUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        showToast('Only image files allowed', 'error');
        e.target.value = '';
        return;
      }
      if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
        showToast(COVERED_IMAGE_SIZE_ERROR_MESSAGE, 'error');
        e.target.value = '';
        return;
      }
      if (file.type === 'image/gif') {
        const token = ++selectionTokenRef.current;
        setIsCompressingRemote(true);
        compressAndCacheDraftImage(file)
          .then(({ previewUrl }) => {
            if (!isCurrent(token)) return;
            if (!previewUrl) throw new Error('No preview produced');
            onSelect(previewUrl);
            onClose();
          })
          .catch(() => {
            if (!isCurrent(token)) return;
            showToast('Could not process that GIF. Please try another.', 'error');
          })
          .finally(() => {
            if (isCurrent(token)) setIsCompressingRemote(false);
          });
      } else {
        setCropTarget(file);
      }
    }
    e.target.value = '';
  };

  const isGifUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    return url.includes('.gif') || url.startsWith('data:image/gif');
  };

  const handleSelectItem = useCallback(
    (itemUrl) => {
      onSelect(itemUrl);
      onClose();
    },
    [onClose, onSelect],
  );

  const handleCropComplete = async (croppedFile) => {
    const token = ++selectionTokenRef.current;
    setIsCompressingRemote(true);
    try {
      const { previewUrl } = await compressAndCacheDraftImage(croppedFile, {
        maxWidthOrHeight: 1280,
      });
      if (!isCurrent(token)) return;
      if (!previewUrl) throw new Error('No preview produced');
      onSelect(previewUrl);
      setCropTarget(null);
      onClose();
    } catch (e) {
      if (!isCurrent(token)) return;
      console.error('Failed to compress image:', e);
      showToast('Image processing failed. Please try again.', 'error');
      setCropTarget(null);
    } finally {
      if (isCurrent(token)) setIsCompressingRemote(false);
    }
  };

  const items = activeTab === 'images' ? PRESET_IMAGES : PRESET_GIFS;
  const isGifTab = activeTab === 'gifs';

  return createPortal(
    <div data-theme={theme} style={{ display: 'contents' }}>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.isModal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.isHeader}>
            <div className={styles.isTitleRow}>
              <span className={styles.dtTitle}>Pick a cover</span>
              <button
                type="button"
                className={styles.dtClose}
                onClick={onClose}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.isTabs}>
              <button
                type="button"
                className={`${styles.isTab} ${activeTab === 'images' ? styles.isTabActive : ''}`}
                onClick={() => setActiveTab('images')}
              >
                Images
              </button>
              <button
                type="button"
                className={`${styles.isTab} ${activeTab === 'gifs' ? styles.isTabActive : ''}`}
                onClick={() => setActiveTab('gifs')}
              >
                GIFs
              </button>
            </div>

            <input
              type="file"
              accept={ALLOWED_IMAGE_ACCEPT}
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleCustomUpload}
            />

            <button
              type="button"
              className={styles.uploadBtn}
              onClick={handleUploadClick}
              disabled={isCompressingRemote}
            >
              {isCompressingRemote ? (
                <>
                  <Loader2
                    size={14}
                    style={{
                      marginRight: '6px',
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload size={14} style={{ marginRight: '6px' }} />
                  Upload Image
                </>
              )}
            </button>
          </div>

          <div className={styles.isBody} ref={bodyScrollRef}>
            <div className={styles.isGrid}>
              {items.map((item, idx) => (
                <MediaGridItem
                  key={item.id}
                  item={item}
                  isGif={isGifTab}
                  priority={idx < 6}
                  isLowMemory={isLowMemory}
                  onSelect={handleSelectItem}
                  observerRootRef={bodyScrollRef}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {cropTarget && (
        <MediaCropper
          imageFile={cropTarget}
          aspect={1}
          onCropComplete={handleCropComplete}
          onCancel={() => setCropTarget(null)}
        />
      )}
    </div>,
    document.body,
  );
}
