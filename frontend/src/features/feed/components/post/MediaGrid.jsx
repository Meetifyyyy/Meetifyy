import React, { useState, useEffect, useRef } from 'react';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { deriveThumbnailKey } from '@shared/api/apiClient';
import styles from './MediaGrid.module.css';

/**
 * Custom inline video player component for post feed cards.
 * - Shows timer pill when not hovering
 * - Shows sleek controls (Play/Pause, Seek, Mute, Expand) on hover
 * - NO 3-dots menu button
 * - Clicking expand or video opens MediaViewer
 */
function InlineVideoPlayer({ src, isPortrait, aspect, handleVideoLoaded, handleItemClick, index }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  const fmt = (s) => {
    if (!s || !isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const togglePlay = (e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const handleSeek = (e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    v.currentTime = val;
    setCurrentTime(val);
  };

  const timeString = `${fmt(currentTime)} / ${fmt(duration)}`;

  return (
    <div
      className={`${styles.singleMediaContainer} ${
        isPortrait ? styles.singleMediaPortrait : styles.singleMediaLandscape
      }`}
      onClick={(e) => {
        e.stopPropagation();
        if (videoRef.current) videoRef.current.pause();
        handleItemClick(e, index);
      }}
    >
      <div className={`${styles.videoWrapper} ${styles.inlineVideoWrap}`} style={{ '--aspect': aspect }}>
        <video
          ref={videoRef}
          src={src}
          autoPlay
          playsInline
          muted={muted}
          onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
          onLoadedMetadata={(e) => {
            setDuration(e.target.duration);
            handleVideoLoaded(index);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className={`${styles.singleVideo} ${styles.loaded}`}
        />

        {/* Timer pill when not hovering */}
        <div className={styles.inlineTimerPill}>
          {timeString}
        </div>

        {/* Full controls overlay on hover */}
        <div className={styles.inlineControlsOverlay} onClick={(e) => e.stopPropagation()}>
          <button className={styles.inlineCtrlBtn} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? (
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M6 19h4V5H6zm8-14v14h4V5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <span className={styles.inlineTimeText}>{timeString}</span>

          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className={styles.inlineSeekBar}
          />

          <button className={styles.inlineCtrlBtn} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? (
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            )}
          </button>

          <button
            className={styles.inlineCtrlBtn}
            onClick={(e) => {
              e.stopPropagation();
              if (videoRef.current) videoRef.current.pause();
              handleItemClick(e, index);
            }}
            aria-label="Expand media viewer"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [inlinePlaying, setInlinePlaying] = useState({});

  useEffect(() => {
    const list = normalizeMedia(media);
    let isMounted = true;

    Promise.all(list.map(async (item) => {
      try {
        const thumbKey = item.isVideo ? null : deriveThumbnailKey(item.rawSrc);
        const [fullUrl, thumbUrl] = await Promise.all([
          mediaCache.getUrl(item.rawSrc).catch(() => item.rawSrc),
          thumbKey ? mediaCache.getUrl(thumbKey).catch(() => null) : Promise.resolve(null),
        ]);
        return { ...item, url: thumbUrl || fullUrl || item.rawSrc, fullUrl: fullUrl || item.rawSrc };
      } catch (err) {
        return { ...item, url: item.rawSrc, fullUrl: item.rawSrc };
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

  const handleImageLoad = (index) => {
    setLoadedStates((prev) => ({ ...prev, [index]: true }));
  };

  const handleImageError = (index, e) => {
    const target = e?.target;
    if (!target) return;
    const full = mediaList[index]?.fullUrl;
    if (full && target.src !== full && target.getAttribute('data-fellback') !== '1') {
      target.setAttribute('data-fellback', '1');
      target.src = full;
      return;
    }
    setLoadedStates((prev) => ({ ...prev, [index]: true }));
    target.onerror = null;
    target.src = FALLBACK_POST_IMAGE;
  };

  const handleVideoLoaded = (index) => {
    setLoadedStates((prev) => ({ ...prev, [index]: true }));
  };

  const handleItemClick = (e, index) => {
    e.stopPropagation();
    if (onMediaClick) {
      const formattedItems = mediaList.map((m) => ({
        url: m.fullUrl || m.url,
        type: m.type,
        caption: '',
      }));
      onMediaClick(formattedItems, index);
    }
  };

  // Single Media item (Image or Video)
  if (mediaList.length === 1) {
    const item = mediaList[0];

    // Determine deterministic aspect ratio before load
    const aspect =
      item.raw?.width && item.raw?.height
        ? item.raw.width / item.raw.height
        : item.isVideo ? 16 / 9 : 1;

    const isPortrait = aspect < 1;

    if (item.isVideo) {
      const isLoaded = loadedStates[0];
      const isPlayingInline = Boolean(inlinePlaying[0]);
      const posterUrl = item.raw?.poster || item.raw?.thumbnail || item.raw?.thumbnailUrl;

      if (isPlayingInline) {
        return (
          <InlineVideoPlayer
            src={item.url}
            isPortrait={isPortrait}
            aspect={aspect}
            handleVideoLoaded={handleVideoLoaded}
            handleItemClick={handleItemClick}
            index={0}
          />
        );
      }

      return (
        <div
          className={`${styles.singleMediaContainer} ${
            isPortrait ? styles.singleMediaPortrait : styles.singleMediaLandscape
          }`}
          onClick={(e) => {
            e.stopPropagation();
            setInlinePlaying((prev) => ({ ...prev, 0: true }));
          }}
        >
          <div
            className={styles.videoWrapper}
            style={{ '--aspect': aspect }}
          >
            {!isLoaded && <div className={styles.skeleton} />}
            {posterUrl ? (
              <img
                src={posterUrl}
                alt="Video thumbnail"
                loading="lazy"
                decoding="async"
                onLoad={() => handleImageLoad(0)}
                onError={(e) => handleImageError(0, e)}
                ref={(imgEl) => {
                  if (imgEl && imgEl.complete && imgEl.naturalWidth && !loadedStates[0]) {
                    handleImageLoad(0);
                  }
                }}
                className={`${styles.singleVideo} ${
                  isLoaded ? styles.loaded : styles.loading
                }`}
              />
            ) : (
              <video
                src={`${item.url}#t=0.001`}
                preload="metadata"
                playsInline
                muted
                onLoadedMetadata={() => handleVideoLoaded(0)}
                onLoadedData={() => handleVideoLoaded(0)}
                ref={(vidEl) => {
                  if (vidEl && vidEl.readyState >= 1 && !loadedStates[0]) {
                    handleVideoLoaded(0);
                  }
                }}
                className={`${styles.singleVideo} ${
                  isLoaded ? styles.loaded : styles.loading
                }`}
              />
            )}
            <div className={styles.playButtonOverlay} aria-label="Play video">
              <svg className={styles.playIcon} viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
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
          className={styles.singleImageWrapper}
          style={{ '--aspect': aspect }}
        >
          {!isLoaded && <div className={styles.skeleton} />}
          <img
            src={item.url}
            alt="Post content"
            loading="lazy"
            decoding="async"
            onLoad={() => handleImageLoad(0)}
            onError={(e) => handleImageError(0, e)}
            ref={(imgEl) => {
              if (imgEl && imgEl.complete && imgEl.naturalWidth && !loadedStates[0]) {
                handleImageLoad(0);
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
