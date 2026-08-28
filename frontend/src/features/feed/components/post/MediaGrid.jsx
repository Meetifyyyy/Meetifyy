import React, { useState, useEffect, useRef, memo, useCallback, useId } from 'react';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { deriveThumbnailKey, getMediaUrl } from '@shared/api/apiClient';
import { Play, Pause, VolumeHigh, VolumeOff, Maximize } from '@shared/components/icons';
import { feedVideoRegistry } from '@shared/utils/feedVideoRegistry';
import styles from './MediaGrid.module.css';

// A post's image must never be replaced by an unrelated picture. This used to
// point at a stock Unsplash photo, so any transient load failure — most often a
// just-uploaded object that has not finished propagating, which is exactly the
// moment a post is created — showed the author a completely different image and
// left them convinced the wrong file had been attached. A failed load now shows
// nothing but its own container, after one delayed retry of the real URL.
const RETRY_DELAYS_MS = [1200, 4000];


/**
 * Format seconds to m:ss string — pure helper, defined once outside component.
 */
function fmtTime(s) {
  if (!s || !isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Custom inline video player component for post feed cards.
 *
 * Performance model:
 *  - React state drives ONLY: playing (button icon), muted (volume icon).
 *  - currentTime / duration / seekbar progress are updated via direct DOM
 *    writes inside a single RAF loop — zero React re-renders per frame.
 *  - IntersectionObserver gates autoplay to visible videos only.
 *  - feedVideoRegistry enforces one-active-video-at-a-time across the feed.
 */
const InlineVideoPlayer = memo(function InlineVideoPlayer({
  src,
  isPortrait,
  aspect,
  handleVideoLoaded,
  handleItemClick,
  index,
}) {
  const uid = useId(); // Stable unique id for registry
  const videoRef = useRef(null);
  const rafRef   = useRef(null);

  // ── Only React state that actually changes rendered icon ────────────────
  const [playing, setPlaying] = useState(false);
  const [muted,   setMuted]   = useState(true);  // start muted for autoplay

  // ── DOM refs for timer pill + seekbar (bypasses React render on timeupdate) ──
  const timerPillRef  = useRef(null);
  const timerTextRef  = useRef(null);
  const seekbarRef    = useRef(null);

  // ── Duration (set once on loadedmetadata, rarely changes) ───────────────
  const durationRef = useRef(0);
  // For seekbar max attr (needs DOM access, not React controlled)
  const seekbarMaxRef = useRef(100);

  // ── RAF-based progress loop ─────────────────────────────────────────────
  const startRAF = useCallback(() => {
    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      const ct  = v.currentTime;
      const dur = durationRef.current;
      const pct = dur > 0 ? ct / dur : 0;

      // Update timer pill text
      if (timerTextRef.current) {
        timerTextRef.current.textContent = `${fmtTime(ct)} / ${fmtTime(dur)}`;
      }

      // Update seekbar value + progress css var directly
      const sb = seekbarRef.current;
      if (sb) {
        sb.value = String(ct);
        sb.style.setProperty('--progress', `${pct * 100}%`);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRAF = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  // ── Video event listeners ────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Register with the global registry (priority 0 = feed video)
    const deregister = feedVideoRegistry.register(uid, v, 0);

    const onPlay  = () => { setPlaying(true);  startRAF(); };
    const onPause = () => {
      setPlaying(false);
      stopRAF();
      feedVideoRegistry.notifyPause(uid);
    };
    const onEnded = () => { setPlaying(false); stopRAF(); };
    const onLoadedMeta = (e) => {
      durationRef.current  = e.target.duration;
      seekbarMaxRef.current = e.target.duration;
      if (seekbarRef.current) {
        seekbarRef.current.max = String(e.target.duration);
      }
      handleVideoLoaded(index, e);
    };
    const onVolumeChange = () => setMuted(v.muted);

    v.addEventListener('play',          onPlay);
    v.addEventListener('pause',         onPause);
    v.addEventListener('ended',         onEnded);
    v.addEventListener('loadedmetadata', onLoadedMeta);
    v.addEventListener('volumechange',  onVolumeChange);

    return () => {
      v.removeEventListener('play',          onPlay);
      v.removeEventListener('pause',         onPause);
      v.removeEventListener('ended',         onEnded);
      v.removeEventListener('loadedmetadata', onLoadedMeta);
      v.removeEventListener('volumechange',  onVolumeChange);
      stopRAF();
      deregister();
    };
  }, [src, uid, index, handleVideoLoaded, startRAF, stopRAF]);

  // ── IntersectionObserver: only play when ≥40% visible ───────────────────
  useEffect(() => {
    const wrapEl = videoRef.current?.parentElement;
    if (!wrapEl) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        const v = videoRef.current;
        if (!v) return;

        if (entry.intersectionRatio >= 0.4) {
          // Attempt autoplay via registry
          feedVideoRegistry.requestPlay(uid);
          v.play().catch(() => {});
        } else {
          // Left viewport — pause
          if (!v.paused) {
            v.pause();
            feedVideoRegistry.notifyPause(uid);
          }
        }
      },
      { threshold: [0, 0.4] },
    );

    obs.observe(wrapEl);
    return () => obs.disconnect();
  }, [uid]);

  // ── Page visibility: pause when tab hidden ───────────────────────────────
  useEffect(() => {
    const onVisChange = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden && !v.paused) {
        v.pause();
        feedVideoRegistry.notifyPause(uid);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [uid]);

  // ── Cleanup RAF + pause on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      stopRAF();
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
    };
  }, [stopRAF]);

  // ── Stable callbacks ──────────────────────────────────────────────────────
  const togglePlay = useCallback((e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      feedVideoRegistry.requestPlay(uid);
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [uid]);

  const toggleMute = useCallback((e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const handleSeek = useCallback((e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = parseFloat(e.target.value);
  }, []);

  const handleExpandClick = useCallback((e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    handleItemClick(e, index);
  }, [handleItemClick, index]);

  const handleContainerClick = useCallback((e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    handleItemClick(e, index);
  }, [handleItemClick, index]);

  return (
    <div
      className={`${styles.singleMediaContainer} ${
        isPortrait ? styles.singleMediaPortrait : styles.singleMediaLandscape
      }`}
      onClick={handleContainerClick}
    >
      <div className={`${styles.videoWrapper} ${styles.inlineVideoWrap}`} style={{ '--aspect': aspect }}>
        <video
          ref={videoRef}
          src={src}
          playsInline
          muted  /* start muted; IntersectionObserver will unmute if registry allows */
          preload="metadata"
          className={`${styles.singleVideo} ${styles.loaded}`}
        />

        {/* Timer pill — updated directly by RAF, NOT by React state */}
        <div ref={timerPillRef} className={styles.inlineTimerPill}>
          <span ref={timerTextRef}>0:00 / 0:00</span>
        </div>

        {/* Full controls overlay on hover */}
        <div className={styles.inlineControlsOverlay} onClick={(e) => e.stopPropagation()}>
          <div className={styles.inlineProgressTrackWrap}>
            {/* Uncontrolled input — value and --progress updated by RAF */}
            <input
              ref={seekbarRef}
              type="range"
              min={0}
              max={100}
              step={0.1}
              defaultValue={0}
              onChange={handleSeek}
              className={styles.inlineSeekBar}
              aria-label="Seek"
            />
          </div>

          <div className={styles.inlineControlsRow}>
            <div className={styles.inlineCtrlGroupLeft}>
              <button
                className={`${styles.inlineCtrlBtn} ${!playing ? styles.inlineCtrlBtnPlay : ''}`}
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing
                  ? <Pause size={14} strokeWidth={1.75} />
                  : <Play  size={14} strokeWidth={1.75} />}
              </button>
              {/* Timer text in controls row — reuse same ref via separate span */}
              <span className={styles.inlineTimeText} aria-hidden="true">
                {/* Populated by RAF; initial placeholder */}
                <span ref={(el) => { if (el && !timerTextRef.current) timerTextRef.current = el; }} />
              </span>
            </div>

            <div className={styles.inlineCtrlGroupRight}>
              <button className={styles.inlineCtrlBtn} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted
                  ? <VolumeOff  size={14} strokeWidth={1.75} />
                  : <VolumeHigh size={14} strokeWidth={1.75} />}
              </button>

              <button
                className={styles.inlineCtrlBtn}
                onClick={handleExpandClick}
                aria-label="Expand media viewer"
              >
                <Maximize size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * Normalizes a raw media object/string/array into a standardized array of items with intrinsic aspect ratio.
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
    if (!item) return null;
    const rawSrc = item.url || item.storageKey || item.path || item.objectKey || '';
    if (!rawSrc) return null;

    const typeStr = (item.type || item.mimeType || '').toLowerCase();
    const isVideo =
      typeStr === 'video' ||
      typeStr.startsWith('video/') ||
      rawSrc.endsWith('.mp4') ||
      rawSrc.endsWith('.webm') ||
      rawSrc.startsWith('data:video');

    const width = Number(item.width || item.raw?.width || item.originalWidth) || null;
    const height = Number(item.height || item.raw?.height || item.originalHeight) || null;
    const aspectRatio = Number(item.aspectRatio || item.raw?.aspectRatio) || (width && height ? width / height : null);

    // The URL to paint on the very first render, before the async resolution
    // below has had a chance to run.
    //
    // `/api/media/...` used to be treated as "already usable" and handed
    // straight to `<img src>`. It is a *relative* path, so the browser resolved
    // it against the page's own origin — the static frontend host, which has no
    // such route — and every post image 404'd on first paint. The API generally
    // lives on a different origin (see config.api.baseUrl), and
    // `getMediaUrl` is what knows that. Clicking the image still worked because
    // the viewer resolves its source properly, which is exactly the "broken in
    // the grid, fine in the viewer" split.
    //
    // Only genuinely absolute references are safe to pass through untouched.
    const isAbsolute =
      rawSrc.startsWith('http://') ||
      rawSrc.startsWith('https://') ||
      rawSrc.startsWith('data:') ||
      rawSrc.startsWith('blob:');

    const initialUrl = isAbsolute ? rawSrc : getMediaUrl(rawSrc);

    return {
      raw: item,
      rawSrc: rawSrc,
      url: initialUrl,
      fullUrl: initialUrl,
      width,
      height,
      aspectRatio,
      isVideo,
      type: isVideo ? 'video' : 'image',
    };
  }).filter(Boolean);
}

export function MediaGrid({ media, onMediaClick, onRemove }) {
  const [mediaList, setMediaList] = useState(() => normalizeMedia(media));
  const [loadedStates, setLoadedStates] = useState({});
  // Indices whose media could not be loaded after the retries below. Kept in
  // state so a later-resolved URL clears it instead of being stuck behind an
  // imperative DOM change.
  const [failedStates, setFailedStates] = useState({});
  const [naturalAspects, setNaturalAspects] = useState({});
  const [inlinePlaying, setInlinePlaying] = useState({});

  useEffect(() => {
    const list = normalizeMedia(media);
    if (!list.length) {
      setMediaList([]);
      return;
    }

    let isMounted = true;

    Promise.all(list.map(async (item) => {
      try {
        const thumbKey = item.isVideo ? null : deriveThumbnailKey(item.rawSrc);
        const [fullUrl, thumbUrl] = await Promise.all([
          mediaCache.getUrl(item.rawSrc).catch(() => item.rawSrc),
          thumbKey ? mediaCache.getUrl(thumbKey).catch(() => null) : Promise.resolve(null),
        ]);
        return {
          ...item,
          thumbKey,
          url: thumbUrl || fullUrl || item.rawSrc,
          fullUrl: fullUrl || item.rawSrc,
        };
      } catch (err) {
        return { ...item, url: item.rawSrc, fullUrl: item.rawSrc };
      }
    })).then(resolvedList => {
      if (!isMounted) return;
      setMediaList(resolvedList);
      // These URLs are newly resolved, so any earlier failure was against a
      // different (unresolved) src and should not suppress them.
      setFailedStates({});
    });

    return () => {
      isMounted = false;
    };
  }, [media]);

  if (!mediaList.length) return null;

  const handleImageLoad = (index, e) => {
    setLoadedStates((prev) => ({ ...prev, [index]: true }));
    const naturalWidth = e?.target?.naturalWidth;
    const naturalHeight = e?.target?.naturalHeight;
    if (naturalWidth && naturalHeight && !mediaList[index]?.aspectRatio && !mediaList[index]?.width) {
      setNaturalAspects((prev) => ({
        ...prev,
        [index]: naturalWidth / naturalHeight,
      }));
    }
  };

  const handleImageError = (index, e) => {
    const target = e?.target;
    if (!target) return;
    const item = mediaList[index];
    const full = item?.fullUrl;

    if (item?.thumbKey) {
      mediaCache.invalidate(item.thumbKey);
    }
    if (item?.url) {
      mediaCache.invalidate(item.url);
    }

    // Step 1: the derived thumbnail may not exist (or not yet) — fall back to
    // the original, which is always the real image for this post.
    if (full && target.src !== full && target.getAttribute('data-fellback') !== '1') {
      target.setAttribute('data-fellback', '1');
      target.src = full;
      return;
    }

    // Step 2: the original itself failed. A freshly uploaded object can 404 for
    // a beat, and the server caches that miss briefly, so retry the real URL
    // once rather than giving up on the first attempt.
    const attempts = Number(target.getAttribute('data-retries') || 0);
    if (full && attempts < RETRY_DELAYS_MS.length) {
      target.setAttribute('data-retries', String(attempts + 1));
      const bustedUrl = `${full}${full.includes('?') ? '&' : '?'}r=${Date.now()}`;
      setTimeout(() => {
        if (target.isConnected) target.src = bustedUrl;
      }, RETRY_DELAYS_MS[attempts]);
      return;
    }

    // Step 3: genuinely unavailable for now. Record it in state rather than
    // reaching into the DOM.
    //
    // This previously did `removeAttribute('src')` and set `visibility: hidden`
    // on the node directly. React does not know about either, so when the async
    // URL resolution finished a moment later and re-rendered with a working
    // src, the element stayed blank forever — the imperative hide outlived the
    // reason for it. Driving it from state means a resolved URL simply renders.
    setFailedStates((prev) => ({ ...prev, [index]: true }));
    setLoadedStates((prev) => ({ ...prev, [index]: true }));
  };

  const handleVideoLoaded = (index, e) => {
    setLoadedStates((prev) => ({ ...prev, [index]: true }));
    const vw = e?.target?.videoWidth;
    const vh = e?.target?.videoHeight;
    if (vw && vh && !mediaList[index]?.aspectRatio && !mediaList[index]?.width) {
      setNaturalAspects((prev) => ({
        ...prev,
        [index]: vw / vh,
      }));
    }
  };

  const handleItemClick = (e, index) => {
    e.stopPropagation();
    if (onMediaClick) {
      const formattedItems = mediaList.map((m) => ({
        url: m.fullUrl || m.url || m.rawSrc,
        type: m.type,
        caption: '',
      }));
      onMediaClick(formattedItems, index);
    }
  };

  const renderRemoveButton = (index) => {
    if (!onRemove) return null;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
        className={styles.removeBtn}
        title="Remove attachment"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    );
  };

  // Single Media item (Image or Video)
  if (mediaList.length === 1) {
    const item = mediaList[0];

    // Read natural/metadata aspect ratio directly without forcing into any common ratio
    const aspect =
      naturalAspects[0] ||
      item.aspectRatio ||
      (item.width && item.height ? item.width / item.height : null) ||
      (item.raw?.width && item.raw?.height ? item.raw.width / item.raw.height : null) ||
      (item.isVideo ? 16 / 9 : 1.25);

    const isPortrait = aspect < 1;

    if (item.isVideo) {
      const isLoaded = loadedStates[0];
      const isPlayingInline = Boolean(inlinePlaying[0]);
      const rawPoster = item.raw?.poster || item.raw?.thumbnail || item.raw?.thumbnailUrl;
      const posterUrl = rawPoster ? getMediaUrl(rawPoster) : null;
      const mediaSrc = item.url || (item.rawSrc ? getMediaUrl(item.rawSrc) : null);

      if (isPlayingInline && mediaSrc) {
        return (
          <InlineVideoPlayer
            src={mediaSrc}
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
                onLoad={(e) => handleImageLoad(0, e)}
                onError={(e) => handleImageError(0, e)}
                style={{ visibility: failedStates[0] ? 'hidden' : undefined }}
                ref={(imgEl) => {
                  if (imgEl && imgEl.complete && imgEl.naturalWidth && !loadedStates[0]) {
                    handleImageLoad(0, { target: imgEl });
                  }
                }}
                className={`${styles.singleVideo} ${
                  isLoaded ? styles.loaded : styles.loading
                }`}
              />
            ) : mediaSrc ? (
              <video
                src={`${mediaSrc}#t=0.001`}
                preload="metadata"
                playsInline
                muted
                onLoadedMetadata={(e) => handleVideoLoaded(0, e)}
                onLoadedData={(e) => handleVideoLoaded(0, e)}
                ref={(vidEl) => {
                  if (vidEl && vidEl.readyState >= 1 && !loadedStates[0]) {
                    handleVideoLoaded(0, { target: vidEl });
                  }
                }}
                className={`${styles.singleVideo} ${
                  isLoaded ? styles.loaded : styles.loading
                }`}
              />
            ) : null}
            <div className={styles.playButtonOverlay} aria-label="Play video">
              <svg className={styles.playIcon} viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            {renderRemoveButton(0)}
          </div>
        </div>
      );
    }

    const isLoaded = loadedStates[0];
    const imageSrc = item.url || (item.rawSrc ? getMediaUrl(item.rawSrc) : null);

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
          {imageSrc && (
            <img
              src={imageSrc}
              alt="Post content"
              loading="lazy"
              decoding="async"
              onLoad={(e) => handleImageLoad(0, e)}
              onError={(e) => handleImageError(0, e)}
              style={{ visibility: failedStates[0] ? 'hidden' : undefined }}
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
          )}
          {renderRemoveButton(0)}
        </div>
      </div>
    );
  }

  // Two Images (Side-by-side)
  if (mediaList.length === 2) {
    return (
      <div className={styles.mediaContainer}>
        <div className={styles.gridTwo}>
          {mediaList.map((item, index) => {
            const imgSrc = item.url || (item.rawSrc ? getMediaUrl(item.rawSrc) : null);
            return (
              <div key={index} className={styles.gridItem} onClick={(e) => handleItemClick(e, index)}>
                {!loadedStates[index] && <div className={styles.skeleton} />}
                {imgSrc && (
                  <img
                    src={imgSrc}
                    alt={`Media ${index + 1}`}
                    loading="lazy"
                    decoding="async"
                    onLoad={(e) => handleImageLoad(index, e)}
                    onError={(e) => handleImageError(index, e)}
                    style={{ visibility: failedStates[index] ? 'hidden' : undefined }}
                    className={`${styles.gridImage} ${loadedStates[index] ? styles.loaded : styles.loading}`}
                  />
                )}
                {item.isVideo && (
                  <div className={styles.playButtonOverlay} aria-label="Play video">
                    <svg className={styles.playIcon} viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                )}
                {renderRemoveButton(index)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Three Images (1 Main Left + 2 Stacked Right)
  if (mediaList.length === 3) {
    const firstImgSrc = mediaList[0].url || (mediaList[0].rawSrc ? getMediaUrl(mediaList[0].rawSrc) : null);
    return (
      <div className={styles.mediaContainer}>
        <div className={styles.gridThree}>
          <div className={styles.gridItem} onClick={(e) => handleItemClick(e, 0)}>
            {!loadedStates[0] && <div className={styles.skeleton} />}
            {firstImgSrc && (
              <img
                src={firstImgSrc}
                alt="Media 1"
                loading="lazy"
                decoding="async"
                onLoad={(e) => handleImageLoad(0, e)}
                onError={(e) => handleImageError(0, e)}
                style={{ visibility: failedStates[0] ? 'hidden' : undefined }}
                className={`${styles.gridImage} ${loadedStates[0] ? styles.loaded : styles.loading}`}
              />
            )}
            {mediaList[0].isVideo && (
              <div className={styles.playButtonOverlay} aria-label="Play video">
                <svg className={styles.playIcon} viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            )}
            {renderRemoveButton(0)}
          </div>
          <div className={styles.gridThreeRight}>
            {mediaList.slice(1, 3).map((item, idx) => {
              const index = idx + 1;
              const subSrc = item.url || (item.rawSrc ? getMediaUrl(item.rawSrc) : null);
              return (
                <div key={index} className={styles.gridItem} onClick={(e) => handleItemClick(e, index)}>
                  {!loadedStates[index] && <div className={styles.skeleton} />}
                  {subSrc && (
                    <img
                      src={subSrc}
                      alt={`Media ${index + 1}`}
                      loading="lazy"
                      decoding="async"
                      onLoad={(e) => handleImageLoad(index, e)}
                      onError={(e) => handleImageError(index, e)}
                      style={{ visibility: failedStates[index] ? 'hidden' : undefined }}
                      className={`${styles.gridImage} ${loadedStates[index] ? styles.loaded : styles.loading}`}
                    />
                  )}
                  {item.isVideo && (
                    <div className={styles.playButtonOverlay} aria-label="Play video">
                      <svg className={styles.playIcon} viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  )}
                  {renderRemoveButton(index)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Four or More Images (2x2 Grid)
  const displayItems = mediaList.slice(0, 4);
  const totalCount = mediaList.length;

  return (
    <div className={styles.mediaContainer}>
      <div className={styles.gridFour}>
        {displayItems.map((item, index) => {
          const isLast = index === 3 && totalCount > 4;
          const overlayCount = totalCount - 3; // +2 for 5, +3 for 6
          const subSrc = item.url || (item.rawSrc ? getMediaUrl(item.rawSrc) : null);
          return (
            <div key={index} className={styles.gridItem} onClick={(e) => handleItemClick(e, index)}>
              {!loadedStates[index] && <div className={styles.skeleton} />}
              {subSrc && (
                <img
                  src={subSrc}
                  alt={`Media ${index + 1}`}
                  loading="lazy"
                  decoding="async"
                  onLoad={(e) => handleImageLoad(index, e)}
                  onError={(e) => handleImageError(index, e)}
                  style={{ visibility: failedStates[index] ? 'hidden' : undefined }}
                  className={`${styles.gridImage} ${loadedStates[index] ? styles.loaded : styles.loading}`}
                />
              )}
              {item.isVideo && !isLast && (
                <div className={styles.playButtonOverlay} aria-label="Play video">
                  <svg className={styles.playIcon} viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              )}
              {isLast && (
                <div className={styles.moreOverlay}>
                  <span>+{overlayCount}</span>
                </div>
              )}
              {renderRemoveButton(index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(MediaGrid);
