import { useState, useEffect, useRef, memo, useCallback, useId, useMemo } from 'react';
import { aspectOf, frameFor, carouselHeightRatio, carouselLayout } from '@shared/utils/mediaLayout';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { deriveThumbnailKey, getMediaUrl } from '@shared/api/apiClient';
import { Play, Pause, VolumeHigh, VolumeOff, Maximize } from '@shared/components/icons';
import { feedVideoRegistry } from '@shared/utils/feedVideoRegistry';
import { isThumbnailMissing, markThumbnailMissing } from '@shared/utils/missingThumbnails';
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

  // ── React state for UI controls ──────────────────────────────────────────
  const [playing, setPlaying] = useState(false);
  const [muted,   setMuted]   = useState(false); // start unmuted by default

  // ── DOM refs for timer pill + seekbar ─────────────────────────────────────
  const timerTextRef     = useRef(null);
  const ctrlTimerTextRef = useRef(null);
  const seekbarRef       = useRef(null);
  const durationRef      = useRef(0);

  // ── Real-time progress updater ───────────────────────────────────────────
  const updateProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const ct  = v.currentTime || 0;
    const dur = durationRef.current || v.duration || 0;
    const pct = dur > 0 ? (ct / dur) * 100 : 0;
    const timeStr = fmtTime(ct);

    // Only when the shown second changes. This runs every frame of playback,
    // and assigning textContent always replaces the text node — a DOM mutation
    // per frame, each of which also woke the system-bar sampler's observer.
    if (timerTextRef.current && timerTextRef.current.textContent !== timeStr) {
      timerTextRef.current.textContent = timeStr;
    }
    if (ctrlTimerTextRef.current && ctrlTimerTextRef.current.textContent !== timeStr) {
      ctrlTimerTextRef.current.textContent = timeStr;
    }
    const sb = seekbarRef.current;
    if (sb) {
      sb.value = String(ct);
      sb.style.setProperty('--progress', `${pct}%`);
    }
  }, []);

  // ── RAF-based progress loop ─────────────────────────────────────────────
  const startRAF = useCallback(() => {
    const tick = () => {
      updateProgress();
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [updateProgress]);

  const stopRAF = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const onPlay = useCallback(() => {
    setPlaying(true);
    startRAF();
  }, [startRAF]);

  const onPause = useCallback(() => {
    setPlaying(false);
    stopRAF();
    feedVideoRegistry.notifyPause(uid);
  }, [stopRAF, uid]);

  const onEnded = useCallback(() => {
    setPlaying(false);
    stopRAF();
  }, [stopRAF]);

  const onLoadedMeta = useCallback((e) => {
    const dur = e.target.duration || 0;
    durationRef.current = dur;
    if (seekbarRef.current) {
      seekbarRef.current.max = String(dur || 100);
    }
    updateProgress();
    if (handleVideoLoaded) handleVideoLoaded(index, e);
  }, [handleVideoLoaded, index, updateProgress]);

  const onVolumeChange = useCallback(() => {
    const v = videoRef.current;
    if (v) setMuted(v.muted);
  }, []);

  // ── Video registry and initial setup ─────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const deregister = feedVideoRegistry.register(uid, v, 0);

    if (v.duration && isFinite(v.duration)) {
      durationRef.current = v.duration;
      if (seekbarRef.current) {
        seekbarRef.current.max = String(v.duration);
      }
      updateProgress();
    }
    if (!v.paused) {
      setPlaying(true);
      startRAF();
    }

    return () => {
      stopRAF();
      deregister();
    };
  }, [uid, updateProgress, startRAF, stopRAF]);

  // ── IntersectionObserver: only play when ≥40% visible ───────────────────
  useEffect(() => {
    const wrapEl = videoRef.current?.parentElement;
    if (!wrapEl) return;

    // The last visibility the observer reported. Entries that arrive while a
    // keyboard is up are not acted on (it shrinks the viewport and drops the
    // ratio without anything scrolling, which paused then resumed unmuted),
    // but they are kept and replayed when text entry ends.
    let ratio = 0;
    const decide = () => {
      const v = videoRef.current;
      if (!v) return;
      if (ratio >= 0.4) {
        // The registry refuses a feed video while something it ranks higher (the
        // media viewer, a voice note) is playing. Refused means do not start:
        // it has already paused this one if it was running.
        if (!feedVideoRegistry.requestPlay(uid)) return;
        v.muted = false;
        v.volume = 1;
        v.play().catch(() => {
          // Browser autoplay fallback if unmuted blocked
          v.muted = true;
          setMuted(true);
          v.play().catch(() => {});
        });
      } else if (!v.paused) {
        v.pause();
        feedVideoRegistry.notifyPause(uid);
      }
    };

    const obs = new IntersectionObserver(
      ([entry]) => {
        ratio = entry.intersectionRatio;
        if (document.documentElement.hasAttribute('data-text-entry')) return;
        decide();
      },
      { threshold: [0, 0.4] },
    );
    const onTextEntryEnd = () => decide();
    window.addEventListener('meetifyy:text-entry-end', onTextEntryEnd);

    obs.observe(wrapEl);
    return () => {
      obs.disconnect();
      window.removeEventListener('meetifyy:text-entry-end', onTextEntryEnd);
    };
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

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    return () => {
      stopRAF();
      if (v && !v.paused) v.pause();
    };
  }, [stopRAF]);

  // ── Play / Mute / Seek Actions ───────────────────────────────────────────
  const togglePlay = useCallback((e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (!feedVideoRegistry.requestPlay(uid)) return;
      v.muted = false;
      v.volume = 1;
      setMuted(false);
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [uid]);

  const toggleMute = useCallback((e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const nextMuted = !v.muted;
    v.muted = nextMuted;
    if (!nextMuted) {
      v.volume = 1;
    }
    setMuted(nextMuted);
  }, []);

  const handleSeek = useCallback((e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const targetTime = parseFloat(e.target.value);
    v.currentTime = targetTime;
    updateProgress();
  }, [updateProgress]);

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
          muted={muted}
          preload="metadata"
          className={`${styles.singleVideo} ${styles.loaded}`}
          onPlay={onPlay}
          onPause={onPause}
          onEnded={onEnded}
          onLoadedMetadata={onLoadedMeta}
          onDurationChange={onLoadedMeta}
          onTimeUpdate={updateProgress}
          onVolumeChange={onVolumeChange}
        />

        {/* Floating bottom badges (Timer + Mute button) */}
        <div className={styles.inlineBottomBadges}>
          <div className={styles.inlineTimerPill}>
            <span ref={timerTextRef}>0:00</span>
          </div>
          <button
            type="button"
            className={styles.inlineMuteBadge}
            onClick={toggleMute}
            aria-label={muted ? 'Unmute video' : 'Mute video'}
          >
            {muted ? <VolumeOff size={14} strokeWidth={1.75} /> : <VolumeHigh size={14} strokeWidth={1.75} />}
          </button>
        </div>

        {/* Full controls overlay on hover */}
        <div className={styles.inlineControlsOverlay} onClick={(e) => e.stopPropagation()}>
          <div className={styles.inlineProgressTrackWrap}>
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
                type="button"
                className={`${styles.inlineCtrlBtn} ${!playing ? styles.inlineCtrlBtnPlay : ''}`}
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing
                  ? <Pause size={14} strokeWidth={1.75} />
                  : <Play  size={14} strokeWidth={1.75} />}
              </button>
              <span className={styles.inlineTimeText} aria-hidden="true">
                <span ref={ctrlTimerTextRef}>0:00</span>
              </span>
            </div>

            <div className={styles.inlineCtrlGroupRight}>
              <button
                type="button"
                className={styles.inlineCtrlBtn}
                onClick={toggleMute}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted
                  ? <VolumeOff  size={14} strokeWidth={1.75} />
                  : <VolumeHigh size={14} strokeWidth={1.75} />}
              </button>

              <button
                type="button"
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

    const cachedSyncUrl = !isAbsolute ? mediaCache.getSyncUrl(rawSrc) : null;
    const initialUrl = isAbsolute ? rawSrc : (cachedSyncUrl || getMediaUrl(rawSrc));

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

// Module-level caches ensure images that were already loaded and sized in the feed
// render immediately without flashing/flickering when opening a post, navigating back,
// or on subsequent mounts.
//
// Bounded, because they are module-scoped and every distinct media URL adds an
// entry: a long session scrolling a media-heavy feed grew them without limit.
//
// Evicting the OLDEST entry rather than clearing the whole cache at a
// threshold. Both Set and Map iterate in insertion order, and re-inserting a
// key moves it to the end, so "oldest" means least recently seen. Clearing
// wholesale would drop the entries for media currently on screen too, which
// reintroduces exactly the flicker these caches exist to prevent — and does it
// every time the threshold is crossed.
//
// 500 entries is roughly 150 posts of scroll history at 2-4 images each: far
// enough back that returning to a post still paints instantly, small enough
// that the two caches together are tens of kilobytes.
const MEDIA_CACHE_MAX = 500;
const loadedUrlCache = new Set();
const naturalAspectCache = new Map();

function rememberLoaded(src) {
  if (!src) return;
  loadedUrlCache.delete(src);
  loadedUrlCache.add(src);
  if (loadedUrlCache.size > MEDIA_CACHE_MAX) {
    loadedUrlCache.delete(loadedUrlCache.values().next().value);
  }
}

function rememberAspect(src, aspect) {
  if (!src) return;
  naturalAspectCache.delete(src);
  naturalAspectCache.set(src, aspect);
  if (naturalAspectCache.size > MEDIA_CACHE_MAX) {
    naturalAspectCache.delete(naturalAspectCache.keys().next().value);
  }
}

/**
 * True once the element has come within a screen of the viewport, and stays
 * true. Used to hold back media that would otherwise load for every post the
 * virtualized feed keeps mounted off screen.
 */
function useNearViewport() {
  const [el, setEl] = useState(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          obs.disconnect();
        }
      },
      { rootMargin: '100% 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [el, near]);
  return [setEl, near];
}

/*
 * Per-item state is keyed by the item's own source, never by its position.
 *
 * It was keyed by index. Removing an attachment shifted every later item down
 * one slot, so each inherited its neighbour's "loaded"/"failed"/size state (a
 * loaded tile could flash its skeleton, a fresh one could show as loaded), and
 * carousel tiles keyed `${index}:…` all remounted and reloaded their images.
 */
const itemKey = (item) => item?.rawSrc || '';

export function MediaGrid({ media, onMediaClick, onRemove, authorName }) {
  /*
   * What is shown is derived from `media` during render, with resolved URLs
   * laid over it. It used to be a copy in state, updated only after the async
   * URL resolution below, so removing an attachment showed up a frame or more
   * late — and the whole grid re-rendered from scratch when it did.
   */
  const [resolvedByKey, setResolvedByKey] = useState({});
  const normalized = useMemo(() => normalizeMedia(media), [media]);
  const mediaList = useMemo(
    () => normalized.map((item) => resolvedByKey[itemKey(item)] ?? item),
    [normalized, resolvedByKey],
  );
  const keyAt = (index) => itemKey(mediaList[index]);

  const [loadedStates, setLoadedStates] = useState(() => {
    const initial = {};
    normalizeMedia(media).forEach((item) => {
      const src = item?.url || item?.fullUrl;
      if (src && loadedUrlCache.has(src)) {
        initial[itemKey(item)] = true;
      }
    });
    return initial;
  });
  // Indices whose media could not be loaded after the retries below. Kept in
  // state so a later-resolved URL clears it instead of being stuck behind an
  // imperative DOM change.
  const [failedStates, setFailedStates] = useState({});
  // Video tiles whose poster image failed; they fall back to a first frame.
  const [posterFailed, setPosterFailed] = useState({});
  // The single-video tile mounts its first-frame <video> only near the
  // viewport: the virtualized feed keeps off-screen posts mounted, and each
  // one fetched video metadata — often megabytes for a phone MP4.
  const [singleTileRef, singleTileNear] = useNearViewport();
  const [naturalAspects, setNaturalAspects] = useState(() => {
    const initial = {};
    normalizeMedia(media).forEach((item) => {
      const src = item?.url || item?.fullUrl || item?.rawSrc;
      if (src && naturalAspectCache.has(src)) {
        initial[itemKey(item)] = naturalAspectCache.get(src);
      }
    });
    return initial;
  });
  const [inlinePlaying, setInlinePlaying] = useState({});

  /*
   * The carousel row's height, from the shapes known when the set is first
   * shown — declared dimensions, or ones measured on an earlier mount. Keyed by
   * the set itself, not by `naturalAspects`, so a tile that measures itself
   * later only changes its own width: the card's height never moves.
   */
  const itemsKey = mediaList.map((m) => m.rawSrc).join('|');
  const carouselHeight = useMemo(
    () => carouselHeightRatio(mediaList.map((m) => aspectOf(m) ?? naturalAspectCache.get(m.rawSrc) ?? null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- frozen per set on purpose, see above
    [itemsKey],
  );

  useEffect(() => {
    const list = normalizeMedia(media);
    if (!list.length) return undefined;

    let isMounted = true;

    Promise.all(list.map(async (item) => {
      try {
        // An image's grid variant and a video's poster are the same derived
        // `<name>_thumb.webp`; one that 404'd recently is skipped.
        const derived = deriveThumbnailKey(item.rawSrc);
        const usable = derived && !isThumbnailMissing(derived) ? derived : null;
        const thumbKey = item.isVideo ? null : usable;
        const posterKey = item.isVideo ? usable : null;
        const [fullUrl, thumbUrl, posterUrl] = await Promise.all([
          mediaCache.getUrl(item.rawSrc).catch(() => item.rawSrc),
          thumbKey ? mediaCache.getUrl(thumbKey).catch(() => null) : Promise.resolve(null),
          posterKey ? mediaCache.getUrl(posterKey).catch(() => null) : Promise.resolve(null),
        ]);
        return {
          ...item,
          thumbKey,
          posterKey,
          posterUrl,
          url: thumbUrl || fullUrl || item.rawSrc,
          fullUrl: fullUrl || item.rawSrc,
        };
      } catch (err) {
        return { ...item, url: item.rawSrc, fullUrl: item.rawSrc };
      }
    })).then(resolvedList => {
      if (!isMounted) return;
      // Merge per item, and keep the previous object when nothing changed, so
      // an unchanged tile keeps its <img> (and its decoded pixels) untouched.
      setResolvedByKey((prev) => {
        let changed = false;
        const next = { ...prev };
        resolvedList.forEach((item) => {
          const old = prev[itemKey(item)];
          if (old && old.url === item.url && old.fullUrl === item.fullUrl && old.posterUrl === item.posterUrl) return;
          next[itemKey(item)] = item;
          changed = true;
        });
        return changed ? next : prev;
      });
      // These URLs are newly resolved, so any earlier failure was against a
      // different (unresolved) src and should not suppress them.
      setFailedStates((prev) => (Object.keys(prev).length ? {} : prev));
    });

    return () => {
      isMounted = false;
    };
  }, [media]);

  if (!mediaList.length) return null;

  const handleImageLoad = (index, e) => {
    // The original loaded after its thumbnail failed: that thumbnail really is
    // missing, so later mounts and launches skip straight to the original.
    const failedThumb = e?.target?.getAttribute?.('data-failed-thumb');
    if (failedThumb) {
      markThumbnailMissing(failedThumb);
      e.target.removeAttribute('data-failed-thumb');
    }
    setLoadedStates((prev) => (prev[keyAt(index)] ? prev : { ...prev, [keyAt(index)]: true }));
    const src = mediaList[index]?.url || mediaList[index]?.fullUrl;
    rememberLoaded(src);

    const naturalWidth = e?.target?.naturalWidth;
    const naturalHeight = e?.target?.naturalHeight;
    if (naturalWidth && naturalHeight && !mediaList[index]?.aspectRatio && !mediaList[index]?.width) {
      const aspect = naturalWidth / naturalHeight;
      rememberAspect(src, aspect);
      rememberAspect(mediaList[index]?.rawSrc, aspect);
      setNaturalAspects((prev) => (prev[keyAt(index)] === aspect ? prev : {
        ...prev,
        [keyAt(index)]: aspect,
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
      // Not remembered yet: an offline launch or a 5xx fails the thumbnail
      // too, and marking those would send a day of posts to the full-size
      // original. handleImageLoad records it once the original has loaded,
      // which proves the thumbnail — not the network — was the problem.
      if (item?.thumbKey) target.setAttribute('data-failed-thumb', item.thumbKey);
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
    setFailedStates((prev) => ({ ...prev, [keyAt(index)]: true }));
    setLoadedStates((prev) => ({ ...prev, [keyAt(index)]: true }));
  };

  /** A video tile's poster failed: fall back to its first frame. */
  const handlePosterError = (index) => {
    setPosterFailed((prev) => (prev[keyAt(index)] ? prev : { ...prev, [keyAt(index)]: true }));
  };

  /** What a grid tile paints: the image, or a video's poster (never the MP4). */
  const tileSrc = (item, index) => (item.isVideo
    ? (posterFailed[keyAt(index)] ? null : item.posterUrl || null)
    : item.url || (item.rawSrc ? getMediaUrl(item.rawSrc) : null));

  const onTileError = (index, e) => (mediaList[index]?.isVideo
    ? handlePosterError(index)
    : handleImageError(index, e));

  const handleVideoLoaded = (index, e) => {
    // The first frame loaded after the poster failed: the network is fine, so
    // the poster genuinely does not exist. Remember it.
    const item = mediaList[index];
    if (posterFailed[keyAt(index)] && item?.posterKey) markThumbnailMissing(item.posterKey);
    setLoadedStates((prev) => (prev[keyAt(index)] ? prev : { ...prev, [keyAt(index)]: true }));
    const src = mediaList[index]?.url || mediaList[index]?.fullUrl;
    rememberLoaded(src);

    const vw = e?.target?.videoWidth;
    const vh = e?.target?.videoHeight;
    if (vw && vh && !mediaList[index]?.aspectRatio && !mediaList[index]?.width) {
      const aspect = vw / vh;
      rememberAspect(src, aspect);
      rememberAspect(mediaList[index]?.rawSrc, aspect);
      setNaturalAspects((prev) => (prev[keyAt(index)] === aspect ? prev : {
        ...prev,
        [keyAt(index)]: aspect,
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

  /*
   * Each tile is opened through a real, named button laid over it. The tiles used
   * to be bare <img>/<div> elements with a click handler, so a keyboard or screen
   * reader user could neither reach nor identify them. The name says which one it
   * is and whose post it belongs to; nothing here describes the picture itself,
   * because nothing the author wrote does.
   *
   * Only rendered when something handles the click (the composer's preview grid
   * passes `onRemove` and no `onMediaClick`).
   */
  const openerLabel = (index, verb) => {
    const total = mediaList.length;
    const kind = mediaList[index]?.isVideo ? 'video' : 'photo';
    const position = total > 1 ? ` ${index + 1} of ${total}` : '';
    const by = authorName ? ` by ${authorName}` : '';
    return `${verb} ${kind}${position}${by}`;
  };

  const renderOpener = (index) => {
    if (!onMediaClick) return null;
    return (
      <button
        type="button"
        className={styles.mediaOpener}
        aria-label={openerLabel(index, 'Open')}
        onClick={(e) => handleItemClick(e, index)}
      />
    );
  };

  // A lone video starts playing in place; the viewer opens from the player's
  // expand control. This button is that "play" step for keyboards.
  const renderPlayOpener = (index) => (
    <button
      type="button"
      className={styles.mediaOpener}
      aria-label={openerLabel(index, 'Play')}
      onClick={(e) => {
        e.stopPropagation();
        setInlinePlaying((prev) => ({ ...prev, [keyAt(index)]: true }));
      }}
    />
  );

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
    // Declared size first: it is known before load, so the frame is final on
    // the first paint. A measured size covers older rows that never stored one.
    const declared = aspectOf(item) ?? naturalAspects[keyAt(0)] ?? null;
    const frame = frameFor(declared ?? (item.isVideo ? 16 / 9 : 1.25));
    const aspect = frame.aspect;

    const isPortrait = aspect < 1;

    if (item.isVideo) {
      const isLoaded = loadedStates[keyAt(0)];
      const isPlayingInline = Boolean(inlinePlaying[keyAt(0)]);
      const rawPoster = item.raw?.poster || item.raw?.thumbnail || item.raw?.thumbnailUrl;
      const posterUrl = rawPoster
        ? getMediaUrl(rawPoster)
        : (posterFailed[keyAt(0)] ? null : item.posterUrl || null);
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
            setInlinePlaying((prev) => ({ ...prev, [keyAt(0)]: true }));
          }}
        >
          <div
            ref={singleTileRef}
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
                onError={() => handlePosterError(0)}
                style={{ visibility: failedStates[keyAt(0)] ? 'hidden' : undefined }}
                ref={(imgEl) => {
                  if (imgEl && imgEl.complete && imgEl.naturalWidth && !loadedStates[keyAt(0)]) {
                    handleImageLoad(0, { target: imgEl });
                  }
                }}
                className={`${styles.singleVideo} ${frame.crop ? styles.cropped : ''} ${
                  isLoaded ? styles.loaded : styles.loading
                }`}
              />
            ) : mediaSrc && singleTileNear ? (
              <video
                src={`${mediaSrc}#t=0.001`}
                preload="metadata"
                playsInline
                muted
                onLoadedMetadata={(e) => handleVideoLoaded(0, e)}
                onLoadedData={(e) => handleVideoLoaded(0, e)}
                ref={(vidEl) => {
                  if (vidEl && vidEl.readyState >= 1 && !loadedStates[keyAt(0)]) {
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
            {renderPlayOpener(0)}
            {renderRemoveButton(0)}
          </div>
        </div>
      );
    }

    const isLoaded = loadedStates[keyAt(0)];
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
              style={{ visibility: failedStates[keyAt(0)] ? 'hidden' : undefined }}
              ref={(imgEl) => {
                if (imgEl && imgEl.complete && imgEl.naturalWidth && !loadedStates[keyAt(0)]) {
                  handleImageLoad(0, { target: imgEl });
                }
              }}
              onClick={(e) => handleItemClick(e, 0)}
              className={`${styles.singleImage} ${frame.crop ? styles.cropped : ''} ${
                isLoaded ? styles.loaded : styles.loading
              }`}
            />
          )}
          {renderOpener(0)}
          {renderRemoveButton(0)}
        </div>
      </div>
    );
  }

  // Two or more: one horizontal row, sized from each item's real shape.
  return (
    <MediaCarousel
      items={mediaList}
      heightRatio={carouselHeight}
      naturalAspects={naturalAspects}
      loadedStates={loadedStates}
      failedStates={failedStates}
      tileSrc={tileSrc}
      onTileLoad={handleImageLoad}
      onTileError={onTileError}
      onItemClick={handleItemClick}
      renderOpener={renderOpener}
      renderRemoveButton={renderRemoveButton}
    />
  );
}

/**
 * A horizontally scrolling row of media tiles.
 *
 * Native scrolling, not a JS gesture: touch, trackpad and shift-wheel all work
 * with the platform's own physics, and scroll-snap lands each swipe on an item.
 * The row's height is fixed by the parent from the items' known shapes, so the
 * card never changes height while swiping or while tiles load; each tile's
 * width is its height times its own aspect, capped so the next tile always
 * shows at the edge.
 *
 * The arrow buttons exist for a mouse with no horizontal wheel. They are only
 * shown to fine pointers that hover; touch and trackpad users just swipe.
 */
const MediaCarousel = memo(function MediaCarousel({
  items,
  heightRatio,
  naturalAspects,
  loadedStates,
  failedStates,
  tileSrc,
  onTileLoad,
  onTileError,
  onItemClick,
  renderOpener,
  renderRemoveButton,
}) {
  const scrollerRef = useRef(null);
  const keyAt = (index) => itemKey(items[index]);
  const [edges, setEdges] = useState({ start: true, end: false });

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; updateEdges(); });
    };
    updateEdges();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [updateEdges, items.length]);

  /*
   * Scroll straight to the neighbouring tile's snap point. Scrolling by a
   * fraction of the width landed between tiles, and scroll-snap then pulled it
   * the rest of the way: two motions for one click.
   */
  const step = (dir) => (e) => {
    e.stopPropagation();
    const el = scrollerRef.current;
    if (!el) return;
    const starts = Array.from(el.children, (c) => c.offsetLeft - el.firstElementChild.offsetLeft);
    const maxLeft = el.scrollWidth - el.clientWidth;
    const here = el.scrollLeft;
    const target = dir > 0
      ? starts.find((x) => x > here + 2) ?? maxLeft
      : [...starts].reverse().find((x) => x < here - 2) ?? 0;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: Math.min(target, maxLeft), behavior: reduce ? 'auto' : 'smooth' });
  };

  const layout = carouselLayout(
    items.map((item) => aspectOf(item) ?? naturalAspects[itemKey(item)] ?? null),
    heightRatio,
  );

  return (
    <div className={styles.carousel} style={{ '--row-h': heightRatio }}>
      <div
        ref={scrollerRef}
        className={styles.carouselTrack}
        role="group"
        aria-label={`${items.length} attachments, scroll sideways for more`}
      >
        {items.map((item, index) => {
          const src = tileSrc(item, index);
          const frame = layout.items[index];
          return (
            <div
              key={itemKey(item) || index}
              className={styles.carouselItem}
              style={{ '--a': frame.aspect }}
              onClick={(e) => onItemClick(e, index)}
            >
              {!loadedStates[keyAt(index)] && <div className={styles.skeleton} />}
              {src && (
                <img
                  src={src}
                  alt={`Media ${index + 1}`}
                  loading={index < 2 ? 'eager' : 'lazy'}
                  decoding="async"
                  draggable={false}
                  onLoad={(e) => onTileLoad(index, e)}
                  onError={(e) => onTileError(index, e)}
                  ref={(imgEl) => {
                    if (imgEl && imgEl.complete && imgEl.naturalWidth && !loadedStates[keyAt(index)]) {
                      onTileLoad(index, { target: imgEl });
                    }
                  }}
                  style={{ visibility: failedStates[keyAt(index)] ? 'hidden' : undefined }}
                  className={`${styles.carouselImage} ${
                    loadedStates[keyAt(index)] ? styles.loaded : styles.loading
                  }`}
                />
              )}
              {item.isVideo && (
                <div className={styles.playButtonOverlay} aria-label="Play video">
                  <svg className={styles.playIcon} viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              )}
              {renderOpener(index)}
              {renderRemoveButton(index)}
            </div>
          );
        })}
      </div>
      {!edges.start && (
        <button type="button" data-no-press className={`${styles.carouselArrow} ${styles.carouselPrev}`} aria-label="Previous attachment" onClick={step(-1)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      )}
      {!edges.end && (
        <button type="button" data-no-press className={`${styles.carouselArrow} ${styles.carouselNext}`} aria-label="Next attachment" onClick={step(1)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      )}
    </div>
  );
});

export default memo(MediaGrid);
