import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { useSignedMediaSrc } from '@shared/hooks/useSignedMediaSrc';
import styles from './MediaViewer.module.css';
import {
  Play,
  Pause,
  RefreshCw as ReplayIconComp,
  VolumeHigh,
  VolumeLow,
  VolumeOff as VolumeMuteComp,
  Maximize,
  Minimize,
} from '@shared/components/icons';
import { feedVideoRegistry } from '@shared/utils/feedVideoRegistry';
import { PLAYBACK_PRIORITY } from '@shared/utils/playbackPriority';

// ─── Constants ───────────────────────────────────────────────────────────────
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const HIDE_DELAY_MS = 3000;
const SEEK_TOOLTIP_WIDTH = 52;
const VOLUME_KEY = '__mv_volume__';
const DOUBLE_TAP_MS = 280;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(s) {
  if (!s || !isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/*
 * Zero is a valid saved volume — it is what ArrowDown stores when the user
 * silences a video — so only a missing or unparsable value falls back to full
 * volume. `|| 1` treated 0 as "missing". A stored number outside 0..1 would also
 * make `video.volume = n` throw, so it is clamped rather than trusted.
 */
function getSavedVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 1;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? clamp(n, 0, 1) : 1;
  } catch { return 1; }
}
function saveVolume(v) {
  try { localStorage.setItem(VOLUME_KEY, String(v)); } catch {}
}

// ─── Seek Ripple ──────────────────────────────────────────────────────────────
function SeekRipple({ direction, visible }) {
  if (!visible) return null;
  const isLeft = direction === 'left';
  return (
    <div
      className={`${styles.seekRipple} ${isLeft ? styles.seekRippleLeft : styles.seekRippleRight}`}
      aria-hidden="true"
    >
      <div className={styles.seekRippleIconWrap}>
        <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
          {isLeft ? (
            <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
          ) : (
            <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
          )}
        </svg>
      </div>
      <span className={styles.seekRippleLabel}>{isLeft ? '-10s' : '+10s'}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function VideoViewer({ src: rawSrc, poster: rawPoster, mediaRef, onControlsChange, onStageClick, isCurrent = true }) {
  /*
   * The viewer is handed whatever the opener had — usually an unsigned
   * `/api/media/<key>` URL. For a conversation attachment that URL 404s inside
   * the app, which is what produced "Couldn't play this video" on every chat
   * video. See useSignedMediaSrc for why a <video> tag cannot authorize itself.
   */
  const { src, failed: srcFailed, pending: srcPending, refresh: refreshSrc, attempt } = useSignedMediaSrc(rawSrc);
  // A poster for a conversation attachment is a private key too, so it is signed
  // the same way. A poster that cannot be resolved is cosmetic and just absent.
  const { src: posterSrc } = useSignedMediaSrc(rawPoster || '');

  /*
   * The element the viewer's drag-to-dismiss gesture should move.
   *
   * `MediaViewer` translates whatever `mediaRef` points at, and that was always
   * the <video>. During an error the <video> is hidden, so a swipe dragged an
   * invisible element: the overlay faded and the viewer closed, but nothing
   * floated away with the finger — the gesture simply looked broken.
   *
   * Pointing the ref at the error card instead makes the card the thing that
   * follows the drag, which is the same gesture the user is used to, applied to
   * whatever is actually on screen.
   */
  const errorCardRef = useRef(null);
  const registryId = useId();

  /*
   * `canInteract` as a ref, because the gesture callbacks below are defined
   * before it is computed and must not be rebuilt on every state change.
   */
  const canInteractRef = useRef(false);
  const wrapRef       = useRef(null);
  const videoRef      = useRef(null);
  const progressRef   = useRef(null);
  const hideTimerRef  = useRef(null);
  const rafRef        = useRef(null);

  // Pause video if slide becomes non-current
  useEffect(() => {
    if (!isCurrent && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [isCurrent]);

  // Tap tracking
  const lastTapRef          = useRef({ time: 0, x: 0, y: 0, zone: null });
  const clickTimerRef        = useRef(null);
  const touchStartRef       = useRef({ x: 0, y: 0, time: 0 });
  const touchMovedRef       = useRef(false);
  const isTouchHandledRef   = useRef(false);

  // ── Playback state ──────────────────────────────────────────────────────────
  const [playing, setPlaying]       = useState(false);
  const [ended, setEnded]           = useState(false);
  const [duration, setDuration]     = useState(0);
  /*
   * Two readiness levels, not one. Metadata (HAVE_METADATA) means the duration
   * is known and the controls are usable; a decoded frame (HAVE_CURRENT_DATA)
   * means there is something to look at. Treating the first as the second left
   * an empty video element on screen between them.
   */
  const [metaReady, setMetaReady]   = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [isBuffering, setIsBuf]     = useState(false);

  // Real-time DOM refs for performance (bypassing React re-renders on video tick)
  const progressFillRef     = useRef(null);
  const progressThumbRef    = useRef(null);
  const bufferedFillRef     = useRef(null);
  const currentTimeTextRef  = useRef(null);
  const ariaSecondRef       = useRef(-1);

  // ── Volume ──────────────────────────────────────────────────────────────────
  const [volume, setVolume]         = useState(getSavedVolume);
  const [muted, setMuted]           = useState(false);
  const prevVolRef                  = useRef(getSavedVolume());

  // ── Controls visibility ─────────────────────────────────────────────────────
  const [ctrlVisible, setCtrlVisible] = useState(true);
  const [isDragging, setIsDragging]   = useState(false);
  /*
   * Read by the timers and handlers that must not be rebuilt when a drag starts
   * or ends. `isDragging` used to be a dependency of `resetHideTimer`, which fed
   * the video-event effect, so every seek tore down and rebuilt the element's
   * listeners, its registry entry and its progress loop.
   */
  const isDraggingRef = useRef(false);
  const ctrlVisibleRef = useRef(true);
  ctrlVisibleRef.current = ctrlVisible;

  // Notify parent MediaViewer of control visibility changes
  useEffect(() => {
    if (onControlsChange) onControlsChange(ctrlVisible);
  }, [ctrlVisible, onControlsChange]);

  // ── Hover tooltip on progress bar ──────────────────────────────────────────
  const [hoverTime, setHoverTime]     = useState(null);
  const [hoverX, setHoverX]           = useState(0);

  // ── Speed & menus ───────────────────────────────────────────────────────────
  const [speed, setSpeed]             = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // ── Fullscreen & PiP ────────────────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Error ───────────────────────────────────────────────────────────────────
  const [error, setError]               = useState(false);

  // ── Seek ripple (mobile double-tap feedback) ────────────────────────────────
  const [ripple, setRipple]             = useState(null); // 'left' | 'right' | null
  const rippleTimerRef                  = useRef(null);

  // ── Center play/pause flash feedback ──────────────────────────────────────
  const [tapFeedback, setTapFeedback]   = useState(null); // 'play' | 'pause' | null
  const tapFeedbackTimerRef             = useRef(null);
  // Frame callbacks and the touch-suppression timer, kept so unmount can cancel
  // them instead of letting them touch a component that is gone.
  const feedbackRafRef                  = useRef(null);
  const rippleRafRef                    = useRef(null);
  const touchGuardTimerRef              = useRef(null);

  // ─── Auto-hide timer ────────────────────────────────────────────────────────
  const resetHideTimer = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    // Auto-hide only when playing and not dragging
    const v = videoRef.current;
    if (v && !v.paused && !v.ended && !isDraggingRef.current && !wrapRef.current?.contains(document.activeElement)) {
      hideTimerRef.current = setTimeout(() => {
        if (!wrapRef.current?.contains(document.activeElement)) setCtrlVisible(false);
      }, HIDE_DELAY_MS);
    }
  }, []);

  const showControls = useCallback(() => {
    setCtrlVisible(true);
    resetHideTimer();
  }, [resetHideTimer]);

  const toggleControls = useCallback(() => {
    // Decided outside the state updater: an updater must be pure, and this one
    // started and cleared a timer.
    const next = !ctrlVisibleRef.current;
    setCtrlVisible(next);
    if (next) {
      resetHideTimer();
    } else {
      clearTimeout(hideTimerRef.current);
    }
  }, [resetHideTimer]);

  const handleActivity = useCallback(() => {
    showControls();
  }, [showControls]);

  // ─── Update Progress DOM nodes directly (Performance) ─────────────────────
  const updateProgressDOM = useCallback((ct, dur, bufferedEnd = null) => {
    // Per frame while playing: replace the text node only when the second
    // changes, rather than mutating the DOM sixty times a second.
    const timeText = fmt(ct);
    if (currentTimeTextRef.current && currentTimeTextRef.current.textContent !== timeText) {
      currentTimeTextRef.current.textContent = timeText;
    }
    if (dur > 0) {
      const pct = (ct / dur) * 100;
      if (progressFillRef.current) {
        progressFillRef.current.style.width = `${pct}%`;
      }
      if (progressThumbRef.current) {
        progressThumbRef.current.style.left = `${pct}%`;
      }
      if (progressRef.current && Number.isFinite(dur)) {
        /*
         * Position in seconds with a spoken form, rather than a rounded percent.
         * Written only when the whole second changes: this runs every frame
         * while playing, and a screen reader re-announces any attribute write.
         */
        const whole = Math.floor(ct);
        if (ariaSecondRef.current !== whole) {
          ariaSecondRef.current = whole;
          progressRef.current.setAttribute('aria-valuenow', String(whole));
          progressRef.current.setAttribute('aria-valuetext', `${fmt(ct)} of ${fmt(dur)}`);
        }
      }
      if (bufferedEnd !== null && bufferedFillRef.current) {
        const bufPct = (bufferedEnd / dur) * 100;
        bufferedFillRef.current.style.width = `${bufPct}%`;
      }
    } else {
      if (progressFillRef.current) progressFillRef.current.style.width = '0%';
      if (progressThumbRef.current) progressThumbRef.current.style.left = '0%';
      if (progressRef.current) {
        ariaSecondRef.current = 0;
        progressRef.current.setAttribute('aria-valuenow', '0');
        progressRef.current.setAttribute('aria-valuetext', '0:00');
      }
      if (bufferedFillRef.current) bufferedFillRef.current.style.width = '0%';
    }
  }, []);

  // ─── RAF-based progress tick ─────────────────────────────────────────────
  const startProgressLoop = useCallback(() => {
    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      const bufEnd = v.buffered.length > 0 ? v.buffered.end(v.buffered.length - 1) : null;
      updateProgressDOM(v.currentTime, v.duration, bufEnd);
      rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [updateProgressDOM]);

  const stopProgressLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  // ─── Reset state when src changes ────────────────────────────────────────
  useEffect(() => {
    if (!src) {
      /*
       * An empty src is two different situations and they must not look alike.
       *
       * While the URL is still being signed this is simply "not ready" — and
       * flipping to the error state here, then back to loading a frame later
       * when the signature arrives, is exactly the flicker this component had:
       * error card, then spinner, then video, on every single open.
       *
       * Only once signing has actually finished and produced nothing is there
       * anything to report.
       */
      if (srcPending) {
        setMetaReady(false);
        setFrameReady(false);
        setError(false);
        return;
      }
      setError(true);
      return;
    }
    setPlaying(false);
    setEnded(false);
    updateProgressDOM(0, 0, 0);
    setDuration(0);
    setMetaReady(false);
    setFrameReady(false);
    setIsBuf(false);
    setError(false);
    setHoverTime(null);
    setSpeed(1);
    setShowSpeedMenu(false);
    setCtrlVisible(true);
    stopProgressLoop();
  }, [src, srcPending, attempt, stopProgressLoop, updateProgressDOM]);

  // ─── Autoplay with unmuted/muted fallback ────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Nothing to play yet. Calling play() on a source-less element rejects,
    // and the handler below would turn that rejection into a visible error.
    if (!src || !isCurrent) return;

    let active = true;

    const attemptPlay = () => {
      v.play().catch((err) => {
        if (!active) return;
        if (err.name === 'NotAllowedError' && active) {
          v.muted = true;
          setMuted(true);
          v.play().catch((err2) => {
            console.warn('Muted autoplay also blocked:', err2);
          });
        } else if (err.name !== 'AbortError') {
          setError(true);
        }
      });
    };

    attemptPlay();

    return () => {
      active = false;
      v.pause();
    };
    // `attempt` re-runs this for the new element a retry mounts.
  }, [src, isCurrent, attempt]);

  // ─── Element set-up: runs once per <video> element, not per control change ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    /*
     * The saved level applies to a NEW element. It used to be re-applied by the
     * listener effect below, which also forced `muted = false`, so every seek
     * silently discarded the user's mute (and the muted-autoplay fallback that
     * iOS needs). The element keeps its own volume and mute across a source
     * change, so nothing here needs to run again until it is replaced.
     */
    const vol = getSavedVolume();
    v.volume = vol;
    setVolume(vol);
    setMuted(v.muted);
  }, [attempt]);

  // ─── Registry: one entry per current element ─────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isCurrent) return undefined;
    const deregister = feedVideoRegistry.register(registryId, v, PLAYBACK_PRIORITY.VIEWER);
    feedVideoRegistry.requestPlay(registryId);
    return deregister;
  }, [isCurrent, registryId, attempt]);

  // ─── Video event handlers ────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => {
      if (!isCurrent) { v.pause(); return; }
      feedVideoRegistry.requestPlay(registryId);
      setPlaying(true);
      setEnded(false);
      startProgressLoop();
      resetHideTimer();
    };

    const onPause = () => {
      feedVideoRegistry.notifyPause(registryId);
      setPlaying(false);
      stopProgressLoop();
      clearTimeout(hideTimerRef.current);
      setCtrlVisible(true); // Keep controls visible when paused
    };

    const onEnded = () => {
      feedVideoRegistry.notifyPause(registryId);
      setPlaying(false);
      setEnded(true);
      stopProgressLoop();
      clearTimeout(hideTimerRef.current);
      setCtrlVisible(true); // Keep controls visible on end
    };

    const onWaiting      = () => setIsBuf(true);
    const onPlaying      = () => { setIsBuf(false); resetHideTimer(); };
    const onCanPlay      = () => { setMetaReady(true); setFrameReady(true); setIsBuf(false); };
    const onLoadedMeta   = () => { setDuration(v.duration); setMetaReady(true); };
    const onLoadedData   = () => setFrameReady(true);
    const onLoadStart    = () => { setMetaReady(false); setFrameReady(false); setError(false); };
    const onError        = () => setError(true);
    const onVolumeChange = () => { setMuted(v.muted); setVolume(v.volume); };
    const onRateChange   = () => setSpeed(v.playbackRate);
    const onFsChange     = () => setIsFullscreen(!!document.fullscreenElement);

    v.addEventListener('play',             onPlay);
    v.addEventListener('pause',            onPause);
    v.addEventListener('ended',            onEnded);
    v.addEventListener('waiting',          onWaiting);
    v.addEventListener('playing',          onPlaying);
    v.addEventListener('canplay',          onCanPlay);
    v.addEventListener('loadedmetadata',   onLoadedMeta);
    v.addEventListener('loadeddata',       onLoadedData);
    v.addEventListener('loadstart',        onLoadStart);
    v.addEventListener('error',            onError);
    v.addEventListener('volumechange',     onVolumeChange);
    v.addEventListener('ratechange',       onRateChange);
    document.addEventListener('fullscreenchange', onFsChange);

    /*
     * Catch up with whatever happened before these listeners existed. Effects
     * run after the element has started loading, so its events can already
     * have fired.
     */
    if (v.readyState >= 1) {
      setDuration(v.duration);
      setMetaReady(true);
    }
    if (v.readyState >= 2) setFrameReady(true);
    if (v.readyState >= 3) setIsBuf(false);
    /*
     * An element that is already playing never fires `play` again, so the
     * progress loop has to be restarted here. This is what stops the time and
     * seek bar freezing if this effect is ever re-run mid-playback.
     */
    if (!v.paused && !v.ended) {
      setPlaying(true);
      startProgressLoop();
    }

    return () => {
      v.removeEventListener('play',             onPlay);
      v.removeEventListener('pause',            onPause);
      v.removeEventListener('ended',            onEnded);
      v.removeEventListener('waiting',          onWaiting);
      v.removeEventListener('playing',          onPlaying);
      v.removeEventListener('canplay',          onCanPlay);
      v.removeEventListener('loadedmetadata',   onLoadedMeta);
      v.removeEventListener('loadeddata',       onLoadedData);
      v.removeEventListener('loadstart',        onLoadStart);
      v.removeEventListener('error',            onError);
      v.removeEventListener('volumechange',     onVolumeChange);
      v.removeEventListener('ratechange',       onRateChange);
      document.removeEventListener('fullscreenchange', onFsChange);
      stopProgressLoop();
    };
  }, [src, isCurrent, attempt, registryId, startProgressLoop, stopProgressLoop, resetHideTimer]);

  // ─── Tab/Page visibility: pause when tab hidden ──────────────────────────
  useEffect(() => {
    const onVisChange = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden && !v.paused) {
        v.pause();
        feedVideoRegistry.notifyPause(registryId);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [registryId]);

  // ─── Pause & cleanup on unmount only ───────────────────────────────────────
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v) {
        v.pause();
        feedVideoRegistry.notifyPause(registryId);
      }
      stopProgressLoop();
      clearTimeout(hideTimerRef.current);
      clearTimeout(clickTimerRef.current);
      clearTimeout(rippleTimerRef.current);
      clearTimeout(tapFeedbackTimerRef.current);
      clearTimeout(touchGuardTimerRef.current);
      cancelAnimationFrame(feedbackRafRef.current);
      cancelAnimationFrame(rippleRafRef.current);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [stopProgressLoop, registryId]);

  // ─── Playback actions ─────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    setShowSpeedMenu(false);
    onStageClick?.();
    const v = videoRef.current;
    if (!v) return;
    if (v.ended || v.paused) {
      // Replaying and resuming fail the same way, so they report it the same
      // way. The replay path used to swallow every rejection.
      if (v.ended) v.currentTime = 0;
      v.play().catch((err) => {
        if (err.name !== 'AbortError') {
          setIsBuf(false);
          setError(true);
        }
      });
    } else {
      v.pause();
    }
  }, [onStageClick]);

  const seekBy = useCallback((delta) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = clamp(v.currentTime + delta, 0, v.duration);
    updateProgressDOM(v.currentTime, v.duration);
  }, [updateProgressDOM]);

  const adjustVolume = useCallback((delta) => {
    const v = videoRef.current;
    if (!v) return;
    const next = clamp(v.volume + delta, 0, 1);
    v.volume = next;
    if (next > 0) v.muted = false;
    prevVolRef.current = next;
    saveVolume(next);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted || v.volume === 0) {
      v.muted  = false;
      v.volume = prevVolRef.current > 0 ? prevVolRef.current : 0.5;
    } else {
      prevVolRef.current = v.volume;
      v.muted = true;
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const v = videoRef.current;
      if (!v || !isCurrent || e.defaultPrevented || e.target.closest('[role="dialog"]') !== wrapRef.current?.closest('[role="dialog"]')) return;
      if (e.target.closest('button, [role="slider"], [role="menu"]')) return;
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          showControls();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBy(-5);
          showControls();
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBy(5);
          showControls();
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          seekBy(-10);
          showControls();
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          seekBy(10);
          showControls();
          break;
        case 'ArrowUp':
          e.preventDefault();
          adjustVolume(0.1);
          showControls();
          break;
        case 'ArrowDown':
          e.preventDefault();
          adjustVolume(-0.1);
          showControls();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          showControls();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isCurrent, togglePlay, seekBy, adjustVolume, toggleMute, toggleFullscreen, showControls]);

  // Close speed menu on outside click
  useEffect(() => {
    if (!showSpeedMenu) return;
    const handleOutsideClick = (e) => {
      if (e.target.closest(`.${styles.videoSpeedWrap}`)) return;
      setShowSpeedMenu(false);
    };
    window.addEventListener('click', handleOutsideClick, true);
    window.addEventListener('pointerdown', handleOutsideClick, true);
    return () => {
      window.removeEventListener('click', handleOutsideClick, true);
      window.removeEventListener('pointerdown', handleOutsideClick, true);
    };
  }, [showSpeedMenu]);

  // ─── Seek bar ────────────────────────────────────────────────────────────
  const getSeekFraction = useCallback((clientX) => {
    const bar = progressRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }, []);

  const commitSeek = useCallback((frac) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = frac * v.duration;
    updateProgressDOM(v.currentTime, v.duration);
  }, [updateProgressDOM]);

  const handleProgressMouseDown = useCallback((e) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    setIsDragging(true);
    clearTimeout(hideTimerRef.current);
    setCtrlVisible(true);
    const frac = getSeekFraction(e.clientX);
    commitSeek(frac);
  }, [getSeekFraction, commitSeek]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e) => {
      const frac = getSeekFraction(e.clientX);
      commitSeek(frac);
    };
    const onUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
      resetHideTimer();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, getSeekFraction, commitSeek, resetHideTimer]);

  const handleProgressMouseMove = useCallback((e) => {
    const bar = progressRef.current;
    if (!bar) return;
    const rect  = bar.getBoundingClientRect();
    const frac  = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const v     = videoRef.current;
    if (v && isFinite(v.duration)) setHoverTime(frac * v.duration);
    const rawX = e.clientX - rect.left;
    setHoverX(clamp(rawX, SEEK_TOOLTIP_WIDTH / 2, rect.width - SEEK_TOOLTIP_WIDTH / 2));
  }, []);

  const handleProgressMouseLeave = useCallback(() => {
    setHoverTime(null);
  }, []);

  const handleProgressTouchStart = useCallback((e) => {
    e.stopPropagation();
    const touch = e.touches[0];
    isDraggingRef.current = true;
    setIsDragging(true);
    clearTimeout(hideTimerRef.current);
    setCtrlVisible(true);
    commitSeek(getSeekFraction(touch.clientX));
  }, [getSeekFraction, commitSeek]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e) => {
      const touch = e.touches[0];
      if (touch) commitSeek(getSeekFraction(touch.clientX));
    };
    const onEnd = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
      resetHideTimer();
    };
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    // A touch the system takes over (edge-swipe back, an incoming call) ends in
    // `touchcancel`, never `touchend`. Without this the drag never finished:
    // the controls stopped auto-hiding and any later touch kept seeking.
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [isDragging, getSeekFraction, commitSeek, resetHideTimer]);

  /*
   * The full set of keys the ARIA slider pattern asks for. The window-level
   * shortcuts deliberately ignore a focused slider, so everything it should
   * answer to has to be here: arrows nudge, Page keys step further, Home/End
   * jump to the ends. Up/Down mean "more/less" on a slider, so they seek here
   * rather than changing the volume.
   */
  const handleSliderKeyDown = useCallback((e) => {
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':  seekBy(-5); break;
      case 'ArrowRight':
      case 'ArrowUp':    seekBy(5); break;
      case 'PageDown':   seekBy(-10); break;
      case 'PageUp':     seekBy(10); break;
      case 'Home':       commitSeek(0); break;
      case 'End':        commitSeek(1); break;
      default: return;
    }
    e.preventDefault();
    showControls();
  }, [seekBy, commitSeek, showControls]);

  // ─── Volume ───────────────────────────────────────────────────────────────
  const handleVolumeChange = useCallback((e) => {
    const val = parseFloat(e.target.value);
    const v   = videoRef.current;
    if (!v) return;
    v.volume = val;
    // Zero is saved too: it is a chosen level, not an absence of one.
    saveVolume(val);
    if (val === 0) { v.muted = true; }
    else { v.muted = false; prevVolRef.current = val; }
  }, []);

  // ─── Speed ───────────────────────────────────────────────────────────────
  const handleSetSpeed = useCallback((s) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = s;
    setSpeed(s);
    setShowSpeedMenu(false);
  }, []);

  // ─── Center flash feedback helper ────────────────────────────────────────
  const triggerTapFeedback = useCallback((type) => {
    setTapFeedback(null);
    clearTimeout(tapFeedbackTimerRef.current);
    cancelAnimationFrame(feedbackRafRef.current);
    feedbackRafRef.current = requestAnimationFrame(() => {
      setTapFeedback(type);
      tapFeedbackTimerRef.current = setTimeout(() => setTapFeedback(null), 550);
    });
  }, []);

  // ─── Seek ripple helper ──────────────────────────────────────────────────
  const triggerRipple = useCallback((dir) => {
    setRipple(null);
    clearTimeout(rippleTimerRef.current);
    cancelAnimationFrame(rippleRafRef.current);
    rippleRafRef.current = requestAnimationFrame(() => {
      setRipple(dir);
      rippleTimerRef.current = setTimeout(() => setRipple(null), 650);
    });
  }, []);

  // ─── Calculate interaction zone (Left 30%, Center 40%, Right 30%) ───────
  const getTapZone = useCallback((clientX) => {
    const el = videoRef.current || wrapRef.current;
    if (!el) return 'center';
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 'center';
    const ratio = (clientX - rect.left) / rect.width;
    if (ratio < 0.30) return 'left';
    if (ratio > 0.70) return 'right';
    return 'center';
  }, []);

  // ─── Touch Gesture Handling for 3 Zones & Double-Tap Seeking ─────────────
  const handleTouchStart = useCallback((e) => {
    if (e.target.closest('[data-controls]')) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    touchMovedRef.current = false;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (touchMovedRef.current) return;
    const touch = e.touches[0];
    const dist = Math.hypot(
      touch.clientX - touchStartRef.current.x,
      touch.clientY - touchStartRef.current.y
    );
    if (dist > 12) {
      touchMovedRef.current = true;
      // Moving cancels any pending tap
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (e.target.closest('[data-controls]')) return;
    if (touchMovedRef.current) return;

    // Flag to suppress synthetic mouse clicks
    isTouchHandledRef.current = true;
    clearTimeout(touchGuardTimerRef.current);
    touchGuardTimerRef.current = setTimeout(() => { isTouchHandledRef.current = false; }, 400);

    onStageClick?.();

    const touch = e.changedTouches[0] || touchStartRef.current;
    const zone = getTapZone(touch.clientX);
    const now = Date.now();
    const prev = lastTapRef.current;

    /*
     * With nothing to play, no tap gesture means anything.
     *
     * This guard has to sit ABOVE the double-tap branch, not inside the
     * single-tap timeout where it started: the double-tap path returns early,
     * so a double tap on the error card was still running `seekBy(±10)` and
     * painting the seek ripple over it — a 10-second skip on a video that had
     * never loaded.
     *
     * Keeping the chrome up is the only thing a tap should do here, and it is
     * what stops the close button disappearing behind an error card.
     */
    if (!canInteractRef.current) {
      lastTapRef.current = { time: 0, x: 0, y: 0, zone: null };
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      clearTimeout(hideTimerRef.current);
      setCtrlVisible(true);
      return;
    }

    const isDoubleTap =
      now - prev.time < DOUBLE_TAP_MS &&
      Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y) < 50;

    if (isDoubleTap) {
      // Double tap confirmed — cancel pending single-tap action!
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      lastTapRef.current = { time: 0, x: 0, y: 0, zone: null };

      if (zone === 'left') {
        // Left 30%: Seek backward 10s
        seekBy(-10);
        triggerRipple('left');
      } else if (zone === 'right') {
        // Right 30%: Seek forward 10s
        seekBy(10);
        triggerRipple('right');
      } else {
        // Center 40%: Double tap should NOT seek
        showControls();
      }
    } else {
      // First tap — record & schedule single tap
      lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY, zone };
      clearTimeout(clickTimerRef.current);

      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;

        // SINGLE TAP ACTION
        if (zone === 'center') {
          // Center 40%: Play/Pause toggle
          const v = videoRef.current;
          const willPlay = v ? (v.paused || v.ended) : !playing;
          togglePlay();
          triggerTapFeedback(willPlay ? 'play' : 'pause');
          if (willPlay) {
            showControls(); // Show controls briefly, auto-hide in 3s
          } else {
            setCtrlVisible(true); // Stay visible while paused
          }
        } else {
          // Left 30% / Right 30%: Toggle controls visibility
          toggleControls();
        }
      }, DOUBLE_TAP_MS + 20);
    }
  }, [getTapZone, seekBy, triggerRipple, showControls, togglePlay, triggerTapFeedback, toggleControls, playing, onStageClick]);

  // ─── Desktop Click & Double-Click ─────────────────────────────────────────
  const handleClick = useCallback((e) => {
    if (isTouchHandledRef.current) return;
    if (e.target.closest('[data-controls]')) return;
    e.stopPropagation();
    onStageClick?.();

    // Same rule as the touch path: nothing to play, so only keep chrome up.
    if (!canInteractRef.current) {
      setCtrlVisible(true);
      clearTimeout(hideTimerRef.current);
      return;
    }

    const zone = getTapZone(e.clientX);
    clearTimeout(clickTimerRef.current);

    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      if (zone === 'center') {
        const v = videoRef.current;
        const willPlay = v ? (v.paused || v.ended) : !playing;
        togglePlay();
        triggerTapFeedback(willPlay ? 'play' : 'pause');
        if (willPlay) {
          showControls();
        } else {
          setCtrlVisible(true);
        }
      } else {
        toggleControls();
      }
    }, 240);
  }, [getTapZone, togglePlay, triggerTapFeedback, toggleControls, showControls, playing, onStageClick]);

  const handleDoubleClick = useCallback((e) => {
    if (isTouchHandledRef.current) return;
    if (e.target.closest('[data-controls]')) return;
    e.stopPropagation();
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;

    const zone = getTapZone(e.clientX);
    if (zone === 'left') {
      seekBy(-10);
      triggerRipple('left');
    } else if (zone === 'right') {
      seekBy(10);
      triggerRipple('right');
    } else {
      showControls();
    }
  }, [getTapZone, seekBy, triggerRipple, showControls]);

  // ─── Volume display helpers ───────────────────────────────────────────────
  const effectiveVolume = muted ? 0 : volume;
  /*
   * A source the server refused to sign is an error, not a perpetual spinner —
   * but only once it has actually refused. While `srcPending` is true there is
   * no verdict yet, so neither state may show the error card.
   */
  const hasError = (error || srcFailed) && !srcPending;
  // The spinner covers the signing round trip too, otherwise the viewer opens
  // on an empty black frame until the URL lands.
  /*
   * Only true when the element genuinely has something decoded to paint.
   * Everything else — signing, loading, errored, no source — must hide it so
   * the browser's own placeholder never reaches the screen.
   */
  const hasSource = Boolean(src) && !hasError && !srcPending;
  // Controls and gestures need only the metadata (duration, seekable); the
  // picture needs a decoded frame. Showing the element on metadata alone put an
  // empty native placeholder on screen under live controls.
  const canInteract = hasSource && (metaReady || frameReady);
  const canShowFrame = hasSource && frameReady;
  // A poster is a deliberate stand-in for the first frame, so it may be shown
  // as soon as the controls are.
  const showVideo = canShowFrame || (canInteract && Boolean(posterSrc));

  /*
   * Re-aim the viewer's gesture target whenever the visible element changes.
   *
   * The <video>'s ref callback claims `mediaRef` on mount, so this has to run
   * after it and re-point at the card while an error is showing — and hand it
   * back when the video returns.
   */
  useEffect(() => {
    canInteractRef.current = canInteract;
  }, [canInteract]);

  /*
   * The controls are mounted only while there is something to control, so the
   * seek bar is a brand-new element each time they return. Everything that
   * paints it is driven by the progress loop, which does not run while paused —
   * without this a paused video reopened its controls at 0:00.
   */
  useEffect(() => {
    const v = videoRef.current;
    if (!canInteract || !v) return;
    const bufEnd = v.buffered.length > 0 ? v.buffered.end(v.buffered.length - 1) : null;
    ariaSecondRef.current = -1;
    updateProgressDOM(v.currentTime, v.duration, bufEnd);
  }, [canInteract, updateProgressDOM]);

  /*
   * Deliberately has NO dependency array.
   *
   * It must re-assert the gesture target after every render, because that is
   * how often the ref callbacks above run. A dependency list would let an
   * unrelated re-render leave `mediaRef` pointing at the wrong element until
   * one of the listed values happened to change. This is a ref write with no
   * state and no subscription, so running it each commit costs nothing.
   */
  useEffect(() => {
    if (!isCurrent || !mediaRef) return;
    mediaRef.current = hasError ? errorCardRef.current : videoRef.current;
  });

  // Spinner while the source is signing or its metadata is outstanding, and
  // while a requested play is waiting on its first frame or on the network. Not
  // for a video that is merely paused awaiting a tap.
  const showSpinner =
    (srcPending || !metaReady || (playing && (!frameReady || isBuffering))) &&
    !hasError &&
    (Boolean(src) || srcPending);
  const hasDuration = duration > 0 && isFinite(duration);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapRef}
      className={styles.videoWrap}
      onMouseMove={handleActivity}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      data-fullscreen={isFullscreen || undefined}
    >
      {/* ── Video element ── */}
      <video
        /*
         * This callback owns `videoRef` only — it must NOT claim `mediaRef`.
         *
         * An inline ref callback is invoked on every render (detached with
         * null, then reattached). It used to assign `mediaRef.current = el`
         * there, which silently undid the error-state assignment below on any
         * unrelated re-render — a controls toggle was enough. The drag gesture
         * then moved the hidden <video> again, so the error card sat still
         * while only the backdrop faded: a dismiss that looked like a fade
         * rather than a swipe.
         */
        ref={(el) => {
          videoRef.current = el;
        }}
        /*
         * Omitted, never empty.
         *
         * `src=""` is not "no source" to a browser — it is an INVALID source:
         * the element errors immediately and Chrome paints its own broken-media
         * placeholder, which on Android is a large play triangle. That is the
         * "native play/pause controls flashing" and the giant blurred play icon
         * behind the error card; both were the WebView's default UI showing
         * through for the frames before a real URL arrived.
         *
         * `undefined` removes the attribute, so the element simply has nothing
         * to load and stays quiet. The element is never conditionally
         * rendered, so it is not recreated when the URL resolves — it keeps its
         * identity and just gets a source. Only a retry replaces it.
         */
        /*
         * Keyed by the retry count so a retry mounts a fresh element. A retry
         * whose URL is unchanged (public, blob, already-absolute) otherwise
         * hands the same element the same `src`, which starts no load at all
         * and left a permanent spinner.
         */
        key={attempt}
        src={src || undefined}
        poster={posterSrc || undefined}
        className={styles.viewerVideo}
        playsInline
        autoPlay={isCurrent}
        preload={isCurrent ? "auto" : "metadata"}
        aria-label="Video player"
        /*
         * Hidden unless it has an actual frame to show.
         *
         * A <video> with no decodable source is not blank — Chrome paints its
         * own poster placeholder, which on Android is the large play triangle.
         * Removing the `src` attribute does not clear that: per spec the media
         * element keeps its state until it is explicitly reset, so the
         * placeholder simply stays.
         *
         * It used to be gated on `isLoading` alone. That left it visible during
         * the error state and, worse, for the whole of a retry: clearing the
         * error unmounted the opaque overlay a frame before `isLoading` went
         * back to true, so the placeholder was uncovered and then faded out
         * over 300ms. That is the flash of a giant play button on every
         * "Try again".
         *
         * `visibility` as well as opacity, because an opacity-0 element is
         * still painted and the transition made that a visible fade rather than
         * an instant hide. The transition is deliberately one-way: fading IN
         * when the video is ready is pleasant, fading OUT just prolongs the
         * thing being hidden.
         */
        style={
          showVideo
            ? { opacity: 1, visibility: 'visible', transition: 'opacity 0.2s ease' }
            : { opacity: 0, visibility: 'hidden', transition: 'none' }
        }
        onDragStart={(e) => e.preventDefault()}
      />

      {/* ── Loading / Buffering spinner ───────────────────────────────────── */}
      {showSpinner && (
        <div className={styles.videoSpinnerWrap} aria-hidden="true">
          <div className={styles.videoSpinner} />
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {hasError && (
        /*
         * `data-controls` marks this as interactive UI rather than the video
         * surface, which is what every gesture handler on the stage tests for
         * before acting.
         *
         * Without it a tap on "Try again" was ALSO read as a tap on the video:
         * `handleTouchStart`/`handleTouchEnd` run on touch, before the button's
         * own click handler and unaffected by its `stopPropagation`, so the
         * gesture toggled playback and flashed the centre play/pause icon over
         * the error text. The retry worked; the stray icon on top of it was a
         * second, unrelated gesture firing on the same tap.
         */
        <div className={styles.videoError} role="alert">
          {/*
            `data-controls` sits on the CARD, not on the layer around it.

            Every gesture handler on the stage tests for that attribute before
            acting, so putting it on the full-bleed layer made the whole screen
            inert: swipe-to-dismiss lost its animation and tapping empty space
            stopped toggling the header. On the card alone it does the one job
            it is for — a tap on "Try again" is a button press, not a tap on the
            video surface — while the backdrop stays live.
          */}
          {/*
            The drag target. `MediaViewer` translates whatever `mediaRef` points
            at, so pointing it at the card rather than the full-bleed layer
            means the box itself follows the finger — the same thing a video
            element does — and the `will-change` on this class applies to the
            element actually being moved.
          */}
          <div className={styles.videoErrorCard} data-controls ref={errorCardRef}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="44" height="44">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" />
              <circle cx="12" cy="16" r="0.75" fill="currentColor" stroke="none" />
            </svg>
            <span>Couldn't play this video</span>
            <button
            className={styles.videoRetryBtn}
            onClick={(e) => {
              e.stopPropagation();
              /*
               * Re-sign AND restart. The usual reason a media url stops working
               * is that its signature expired, so `refreshSrc()` drops the
               * cached entry and asks for a new one. It also bumps `attempt`,
               * which keys the <video>: for a source that needs no signing the
               * URL comes back unchanged, and a new element is the only thing
               * that makes the browser load it again. No `v.load()`: a new
               * element or a new `src` already starts exactly one load.
               */
              setError(false);
              refreshSrc();
            }}
          >
            Try again
            </button>
          </div>
        </div>
      )}

      {/* ── Seek ripple (left 30% / right 30% double-tap) ──────────────────── */}
      <SeekRipple direction="left"  visible={ripple === 'left'}  />
      <SeekRipple direction="right" visible={ripple === 'right'} />

      {/*
        ── Center play/pause flash ────────────────────────────────────────
        Also gated on `canInteract`: this is feedback for a playback gesture,
        so it is meaningless when there is nothing playing, and belongs nowhere
        near the error card. Defence in depth behind the `data-controls` fix
        above — any future gesture path that slips through still cannot draw a
        play icon over an error.
      */}
      {tapFeedback && canInteract && (
        <div key={tapFeedback + Date.now()} className={styles.tapFeedback} aria-hidden="true">
          {tapFeedback === 'play' ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="44" height="44">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="44" height="44">
              <path d="M6 19h4V5H6zm8-14v14h4V5z" />
            </svg>
          )}
        </div>
      )}

      {/* ── Center replay button on video end ── */}
      {/* Same gate: a replay affordance over a video that never played is a
          second stray control on the error card. */}
      {ended && canInteract && (
        <button
          className={styles.centerReplayBtn}
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          aria-label="Replay video"
          title="Replay"
        >
          <ReplayIconComp size={32} strokeWidth={1.75} />
        </button>
      )}

      {/*
        ── Controls overlay ───────────────────────────────────────────────
        Gated on `canInteract`, not just on `!hasError`.

        The src-change reset calls `setCtrlVisible(true)` so the controls are up
        when a video opens. On a retry that reset runs again while there is
        still nothing to play, so the overlay — including its large centre
        play button — was drawn over a blank element for the length of the
        signing round trip, then removed. Controls belong to a video that
        exists; until one does, the spinner is the whole UI.
      */}
      {canInteract && (
        <div
          data-controls
          inert={!ctrlVisible || !isCurrent ? '' : undefined}
          aria-hidden={!ctrlVisible || !isCurrent}
          className={`${styles.videoControlsOverlay} ${ctrlVisible ? styles.controlsOverlayVisible : ''}`}
        >
          <div className={styles.videoGradient} aria-hidden="true" />

          <div className={styles.videoProgressArea}>
            {hoverTime !== null && hasDuration && (
              <div className={styles.seekTooltip} style={{ left: hoverX }} aria-hidden="true">
                {fmt(hoverTime)}
              </div>
            )}
            <div
              ref={progressRef}
              className={styles.videoProgressTrack}
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={hasDuration ? Math.floor(duration) : 0}
              aria-valuenow={0}
              aria-valuetext="0:00"
              tabIndex={0}
              onMouseDown={handleProgressMouseDown}
              onMouseMove={handleProgressMouseMove}
              onMouseLeave={handleProgressMouseLeave}
              onTouchStart={handleProgressTouchStart}
              onKeyDown={handleSliderKeyDown}
            >
              <div className={styles.videoProgressBg} />
              <div ref={bufferedFillRef} className={styles.videoProgressBuffer} style={{ width: '0%' }} />
              <div ref={progressFillRef} className={styles.videoProgressFill}  style={{ width: '0%' }} />
              <div ref={progressThumbRef} className={styles.videoProgressThumb} style={{ left: '0%' }} />
            </div>
          </div>

          <div className={styles.videoControlsRow}>
            <div className={styles.videoCtrlGroup}>
              <button
                className={`${styles.videoBtn} ${!playing && !ended ? styles.videoBtnPlay : ''}`}
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                aria-label={ended ? 'Replay' : playing ? 'Pause' : 'Play'}
                title={ended ? 'Replay (K)' : playing ? 'Pause (K)' : 'Play (K)'}
              >
                {ended
                  ? <ReplayIconComp size={22} strokeWidth={1.75} />
                  : playing
                    ? <Pause size={22} strokeWidth={1.75} />
                    : <Play size={22} strokeWidth={1.75} />
                }
              </button>
              <div className={styles.videoVolGroup}>
                <button
                  className={styles.videoBtn}
                  onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                  aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
                  title="Mute (M)"
                >
                  {effectiveVolume === 0
                    ? <VolumeMuteComp size={18} strokeWidth={1.75} />
                    : effectiveVolume < 0.5
                      ? <VolumeLow size={18} strokeWidth={1.75} />
                      : <VolumeHigh size={18} strokeWidth={1.75} />
                  }
                </button>
                <div className={styles.videoVolSliderWrap}>
                  <input
                    type="range"
                    min={0} max={1} step={0.02}
                    value={effectiveVolume}
                    onChange={handleVolumeChange}
                    onClick={(e) => e.stopPropagation()}
                    className={styles.videoVolSlider}
                    aria-label="Volume"
                    style={{ '--vol': effectiveVolume }}
                  />
                </div>
              </div>
              <span className={styles.videoTime} aria-label="Current time">
                <span ref={currentTimeTextRef}>0:00</span>
                {hasDuration && <span className={styles.videoTimeSep}> / {fmt(duration)}</span>}
              </span>
            </div>
            <div className={styles.videoCtrlGroup}>
              <div className={styles.videoSpeedWrap}>
                <button
                  className={styles.videoSpeedBtn}
                  onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(v => !v); }}
                  aria-haspopup="listbox"
                  aria-expanded={showSpeedMenu}
                  title="Playback speed"
                >
                  {speed === 1 ? '1×' : `${speed}×`}
                </button>
                {showSpeedMenu && (
                  <div className={styles.videoSpeedMenu} role="listbox" aria-label="Speed">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        role="option"
                        aria-selected={s === speed}
                        className={`${styles.videoSpeedOption} ${s === speed ? styles.active : ''}`}
                        onClick={(e) => { e.stopPropagation(); handleSetSpeed(s); }}
                      >
                        {s === 1 ? 'Normal' : `${s}×`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                className={styles.videoBtn}
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              >
                {isFullscreen
                  ? <Minimize size={18} strokeWidth={1.75} />
                  : <Maximize size={18} strokeWidth={1.75} />
                }
              </button>
            </div>
          </div>

          <div className={styles.videoKeyHints} aria-hidden="true">
            <span>Space · ←→ ±5s · JL ±10s · M mute · F fullscreen</span>
          </div>
        </div>
      )}
    </div>
  );
}