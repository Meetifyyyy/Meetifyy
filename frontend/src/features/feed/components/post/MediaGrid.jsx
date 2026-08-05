import React, { useState, useEffect } from 'react';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import styles from './MediaGrid.module.css';

/**
 * Normalizes a raw media object/string/array into a standardized array of items.
 */
function normalizeMedia(mediaInput) {
  if (!mediaInput) return [];

  let rawList = [];
  if (Array.isArray(mediaInput)) {
    rawList = mediaInput;
  } else if (typeof mediaInput === 'object') {
    rawList = [mediaInput];
  } else if (typeof mediaInput === 'string') {
    rawList = [{ url: mediaInput }];
  }

  return rawList.map((item) => {
    const rawSrc = item.url || item.storageKey || item.path || item.objectKey || '';

    const typeStr = (item.type || item.mimeType || '').toLowerCase();
    const isVideo =
      typeStr === 'video' ||
      typeStr.startsWith('video/') ||
      rawSrc.endsWith('.mp4') ||
      rawSrc.endsWith('.webm') ||
      rawSrc.startsWith('data:video');

    return {
      raw: item,
      rawSrc: rawSrc,
      url: null, // Will be resolved
      isVideo,
      type: isVideo ? 'video' : 'image',
    };
  }).filter((item) => Boolean(item.rawSrc));
}

export function MediaGrid({ media, onMediaClick }) {
  const [mediaList, setMediaList] = useState(() => normalizeMedia(media));
  const [loadedStates, setLoadedStates] = useState({});
  const [singleAspect, setSingleAspect] = useState(null);

  useEffect(() => {
    const list = normalizeMedia(media);
    let isMounted = true;

    Promise.all(list.map(async (item) => {
      try {
        const resolvedUrl = await mediaCache.getUrl(item.rawSrc);
        return { ...item, url: resolvedUrl || item.rawSrc };
      } catch (err) {
        return { ...item, url: item.rawSrc };
      }
    })).then(resolvedList => {
      if (isMounted) setMediaList(resolvedList);
    });

    return () => {
      isMounted = false;
    };
  }, [media]);

  if (!mediaList.length || !mediaList[0].url) return null;

  const FALLBACK_POST_IMAGE = 'https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&auto=format&fit=crop&q=80';

  const handleImageLoad = (index, e) => {
    setLoadedStates((prev) => ({ ...prev, [index]: true }));
    if (index === 0 && e?.target) {
      const { naturalWidth, naturalHeight } = e.target;
      if (naturalWidth && naturalHeight) {
        setSingleAspect(naturalWidth / naturalHeight);
      }
    }
  };

  const handleImageError = (index, e) => {
    setLoadedStates((prev) => ({ ...prev, [index]: true }));
    if (e?.target) {
      e.target.onerror = null;
      e.target.src = FALLBACK_POST_IMAGE;
    }
  };

  const handleVideoLoaded = (index, e) => {
    setLoadedStates((prev) => ({ ...prev, [index]: true }));
    if (index === 0 && e?.target) {
      const { videoWidth, videoHeight } = e.target;
      if (videoWidth && videoHeight) {
        setSingleAspect(videoWidth / videoHeight);
      }
    }
  };

  const handleItemClick = (e, index) => {
    e.stopPropagation();
    if (onMediaClick) {
      const formattedItems = mediaList.map((m) => ({
        url: m.url,
        type: m.type,
        caption: '',
      }));
      onMediaClick(formattedItems, index);
    }
  };

  // Single Media item (Image or Video)
  if (mediaList.length === 1) {
    const item = mediaList[0];

    const rawAspect =
      item.raw?.width && item.raw?.height
        ? item.raw.width / item.raw.height
        : singleAspect;

    // Portrait means height > width (aspect ratio < 1)
    const isPortrait = rawAspect !== null && rawAspect !== undefined && rawAspect < 1;

    if (item.isVideo) {
      const isLoaded = loadedStates[0];
      return (
        <div
          className={`${styles.singleMediaContainer} ${
            isPortrait ? styles.singleMediaPortrait : styles.singleMediaLandscape
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`${styles.videoWrapper} ${
              isLoaded ? styles.loadedWrapper : styles.loadingWrapper
            }`}
          >
            {!isLoaded && <div className={styles.skeleton} />}
            <video
              src={item.url}
              controls
              playsInline
              onLoadedMetadata={(e) => handleVideoLoaded(0, e)}
              onLoadedData={(e) => handleVideoLoaded(0, e)}
              className={`${styles.singleVideo} ${
                isLoaded ? styles.loaded : styles.loading
              }`}
            />
          </div>
        </div>
      );
    }

    const isLoaded = loadedStates[0];

    return (
      <div
        className={`${styles.singleMediaContainer} ${
          isPortrait ? styles.singleMediaPortrait : styles.singleMediaLandscape
        }`}
      >
        <div
          className={`${styles.singleImageWrapper} ${
            isLoaded ? styles.loadedWrapper : styles.loadingWrapper
          }`}
        >
          {!isLoaded && <div className={styles.skeleton} />}
          <img
            src={item.url}
            alt="Post content"
            loading="lazy"
            decoding="async"
            onLoad={(e) => handleImageLoad(0, e)}
            onError={(e) => handleImageError(0, e)}
            ref={(imgEl) => {
              if (imgEl && imgEl.complete && imgEl.naturalWidth && !loadedStates[0]) {
                handleImageLoad(0, { target: imgEl });
              }
            }}
            onClick={(e) => handleItemClick(e, 0)}
            className={`${styles.singleImage} ${
              isLoaded ? styles.loaded : styles.loading
            }`}
          />
        </div>
      </div>
    );
  }

  // Two Images (Side-by-side)
  if (mediaList.length === 2) {
    return (
      <div className={styles.mediaContainer}>
        <div className={styles.gridTwo}>
          {mediaList.map((item, index) => (
            <div key={index} className={styles.gridItem} onClick={(e) => handleItemClick(e, index)}>
              {!loadedStates[index] && <div className={styles.skeleton} />}
              <img
                src={item.url}
                alt={`Media ${index + 1}`}
                loading="lazy"
                decoding="async"
                onLoad={() => handleImageLoad(index)}
                onError={(e) => handleImageError(index, e)}
                className={`${styles.gridImage} ${loadedStates[index] ? styles.loaded : styles.loading}`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Three Images (1 Main Left + 2 Stacked Right)
  if (mediaList.length === 3) {
    return (
      <div className={styles.mediaContainer}>
        <div className={styles.gridThree}>
          <div className={styles.gridItem} onClick={(e) => handleItemClick(e, 0)}>
            {!loadedStates[0] && <div className={styles.skeleton} />}
            <img
              src={mediaList[0].url}
              alt="Media 1"
              loading="lazy"
              decoding="async"
              onLoad={() => handleImageLoad(0)}
              onError={(e) => handleImageError(0, e)}
              className={`${styles.gridImage} ${loadedStates[0] ? styles.loaded : styles.loading}`}
            />
          </div>
          <div className={styles.gridThreeRight}>
            {mediaList.slice(1, 3).map((item, idx) => {
              const index = idx + 1;
              return (
                <div key={index} className={styles.gridItem} onClick={(e) => handleItemClick(e, index)}>
                  {!loadedStates[index] && <div className={styles.skeleton} />}
                  <img
                    src={item.url}
                    alt={`Media ${index + 1}`}
                    loading="lazy"
                    decoding="async"
                    onLoad={() => handleImageLoad(index)}
                    onError={(e) => handleImageError(index, e)}
                    className={`${styles.gridImage} ${loadedStates[index] ? styles.loaded : styles.loading}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Four or More Images (2x2 Grid with +N overlay)
  const displayItems = mediaList.slice(0, 4);
  const remainingCount = mediaList.length - 4;

  return (
    <div className={styles.mediaContainer}>
      <div className={styles.gridFour}>
        {displayItems.map((item, index) => {
          const isLast = index === 3 && remainingCount > 0;
          return (
            <div key={index} className={styles.gridItem} onClick={(e) => handleItemClick(e, index)}>
              {!loadedStates[index] && <div className={styles.skeleton} />}
              <img
                src={item.url}
                alt={`Media ${index + 1}`}
                loading="lazy"
                decoding="async"
                onLoad={() => handleImageLoad(index)}
                onError={(e) => handleImageError(index, e)}
                className={`${styles.gridImage} ${loadedStates[index] ? styles.loaded : styles.loading}`}
              />
              {isLast && (
                <div className={styles.moreOverlay}>
                  <span>+{remainingCount}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MediaGrid;
