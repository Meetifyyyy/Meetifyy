import { useState, useRef, useEffect, useCallback } from 'react';
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

function getSavedVolume() {
  try { return parseFloat(localStorage.getItem(VOLUME_KEY)) || 1; } catch { return 1; }
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
export default function VideoViewer({ src, mediaRef, onControlsChange, onStageClick, isCurrent = true }) {
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
  const [isLoading, setIsLoading]   = useState(true);
  const [isBuffering, setIsBuf]     = useState(false);

  // Real-time DOM refs for performance (bypassing React re-renders on video tick)
  const progressFillRef     = useRef(null);
  const progressThumbRef    = useRef(null);
  const bufferedFillRef     = useRef(null);
  const currentTimeTextRef  = useRef(null);

  // ── Volume ──────────────────────────────────────────────────────────────────
  const [volume, setVolume]         = useState(getSavedVolume);
  const [muted, setMuted]           = useState(false);
  const prevVolRef                  = useRef(getSavedVolume());

  // ── Controls visibility ─────────────────────────────────────────────────────
  const [ctrlVisible, setCtrlVisible] = useState(true);
  const [isDragging, setIsDragging]   = useState(false);

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

  // ─── Auto-hide timer ────────────────────────────────────────────────────────
  const resetHideTimer = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    // Auto-hide only when playing and not dragging
    const v = videoRef.current;
    if (v && !v.paused && !v.ended && !isDragging) {
      hideTimerRef.current = setTimeout(() => {
        setCtrlVisible(false);
      }, HIDE_DELAY_MS);
    }
  }, [isDragging]);

  const showControls = useCallback(() => {
    setCtrlVisible(true);
    resetHideTimer();
  }, [resetHideTimer]);

  const toggleControls = useCallback(() => {
    setCtrlVisible((prev) => {
      const next = !prev;
      if (next) {
        resetHideTimer();
      } else {
        clearTimeout(hideTimerRef.current);
      }
      return next;
    });
  }, [resetHideTimer]);

  const handleActivity = useCallback(() => {
    showControls();
  }, [showControls]);

  // ─── Update Progress DOM nodes directly (Performance) ─────────────────────
  const updateProgressDOM = useCallback((ct, dur, bufferedEnd = null) => {
    if (currentTimeTextRef.current) {
      currentTimeTextRef.current.textContent = fmt(ct);
    }
    if (dur > 0) {
      const pct = (ct / dur) * 100;
      if (progressFillRef.current) {
        progressFillRef.current.style.width = `${pct}%`;
      }
      if (progressThumbRef.current) {
        progressThumbRef.current.style.left = `${pct}%`;
      }
      if (progressRef.current) {
        progressRef.current.setAttribute('aria-valuenow', String(Math.round(pct)));
      }
      if (bufferedEnd !== null && bufferedFillRef.current) {
        const bufPct = (bufferedEnd / dur) * 100;
        bufferedFillRef.current.style.width = `${bufPct}%`;
      }
    } else {
      if (progressFillRef.current) progressFillRef.current.style.width = '0%';
      if (progressThumbRef.current) progressThumbRef.current.style.left = '0%';
      if (progressRef.current) progressRef.current.setAttribute('aria-valuenow', '0');
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
      setIsLoading(false);
      setError(true);
      return;
    }
    setPlaying(false);
    setEnded(false);
    updateProgressDOM(0, 0, 0);
    setDuration(0);
    setIsLoading(true);
    setIsBuf(false);
    setError(false);
    setHoverTime(null);
    setSpeed(1);
    setShowSpeedMenu(false);
    setCtrlVisible(true);
    stopProgressLoop();
  }, [src, stopProgressLoop, updateProgressDOM]);

  // ─── Autoplay with unmuted/muted fallback ────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    let active = true;

    const attemptPlay = () => {
      v.play().catch((err) => {
        if (!active) return;
        if (err.name === 'NotAllowedError') {
          v.muted = true;
          setMuted(true);
          v.play().catch((err2) => {
            console.warn('Muted autoplay also blocked:', err2);
          });
        } else if (err.name !== 'AbortError') {
          setIsLoading(false);
          setError(true);
        }
      });
    };

    attemptPlay();

    return () => {
      active = false;
    };
  }, [src]);

  // ─── Video event handlers ────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Set saved volume
    const vol = getSavedVolume();
    v.volume  = vol;
    v.muted   = false;
    setVolume(vol);
    setMuted(false);

    // Register with global video registry with priority 10 (MediaViewer active video)
    const deregister = feedVideoRegistry.register('media-viewer-video', v, 10);
    feedVideoRegistry.requestPlay('media-viewer-video');

    const onPlay = () => {
      feedVideoRegistry.requestPlay('media-viewer-video');
      setPlaying(true);
      setEnded(false);
      startProgressLoop();
      resetHideTimer();
    };

    const onPause = () => {
      feedVideoRegistry.notifyPause('media-viewer-video');
      setPlaying(false);
      stopProgressLoop();
      clearTimeout(hideTimerRef.current);
      setCtrlVisible(true); // Keep controls visible when paused
    };

    const onEnded = () => {
      feedVideoRegistry.notifyPause('media-viewer-video');
      setPlaying(false);
      setEnded(true);
      stopProgressLoop();
      clearTimeout(hideTimerRef.current);
      setCtrlVisible(true); // Keep controls visible on end
    };

    const onWaiting      = () => setIsBuf(true);
    const onPlaying      = () => { setIsBuf(false); resetHideTimer(); };
    const onCanPlay      = () => { setIsLoading(false); setIsBuf(false); };
    const onLoadedMeta   = () => { setDuration(v.duration); setIsLoading(false); };
    const onLoadStart    = () => { setIsLoading(true); setError(false); };
    const onError        = () => { setIsLoading(false); setError(true); };
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
    v.addEventListener('loadstart',        onLoadStart);
    v.addEventListener('error',            onError);
    v.addEventListener('volumechange',     onVolumeChange);
    v.addEventListener('ratechange',       onRateChange);
    document.addEventListener('fullscreenchange', onFsChange);

    if (v.readyState >= 1) {
      setDuration(v.duration);
      setIsLoading(false);
    }
    if (v.readyState >= 3) {
      setIsBuf(false);
    }

    return () => {
      v.removeEventListener('play',             onPlay);
      v.removeEventListener('pause',            onPause);
      v.removeEventListener('ended',            onEnded);
      v.removeEventListener('waiting',          onWaiting);
      v.removeEventListener('playing',          onPlaying);
      v.removeEventListener('canplay',          onCanPlay);
      v.removeEventListener('loadedmetadata',   onLoadedMeta);
      v.removeEventListener('loadstart',        onLoadStart);
      v.removeEventListener('error',            onError);
      v.removeEventListener('volumechange',     onVolumeChange);
      v.removeEventListener('ratechange',       onRateChange);
      document.removeEventListener('fullscreenchange', onFsChange);
      stopProgressLoop();
      deregister();
    };
  }, [src, startProgressLoop, stopProgressLoop, resetHideTimer]);

  // ─── Tab/Page visibility: pause when tab hidden ──────────────────────────
  useEffect(() => {
    const onVisChange = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden && !v.paused) {
        v.pause();
        feedVideoRegistry.notifyPause('media-viewer-video');
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, []);

  // ─── Pause & cleanup on unmount only ───────────────────────────────────────
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v) {
        v.pause();
        feedVideoRegistry.notifyPause('media-viewer-video');
      }
      stopProgressLoop();
      clearTimeout(hideTimerRef.current);
      clearTimeout(clickTimerRef.current);
      clearTimeout(rippleTimerRef.current);
      clearTimeout(tapFeedbackTimerRef.current);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [stopProgressLoop]);

  // ─── Playback actions ─────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    setShowSpeedMenu(false);
    onStageClick?.();
    const v = videoRef.current;
    if (!v) return;
    if (v.ended) {
      v.currentTime = 0;
      v.play().catch(() => {});
    } else if (v.paused) {
      v.play().catch((err) => {
        if (err.name !== 'AbortError') {
          setIsLoading(false);
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
      if (!v) return;
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
  }, [togglePlay, seekBy, adjustVolume, toggleMute, toggleFullscreen, showControls]);

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
      setIsDragging(false);
      resetHideTimer();
    };
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [isDragging, getSeekFraction, commitSeek, resetHideTimer]);

  // ─── Volume ───────────────────────────────────────────────────────────────
  const handleVolumeChange = useCallback((e) => {
    const val = parseFloat(e.target.value);
    const v   = videoRef.current;
    if (!v) return;
    v.volume = val;
    if (val === 0) { v.muted = true; }
    else { v.muted = false; prevVolRef.current = val; saveVolume(val); }
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
    requestAnimationFrame(() => {
      setTapFeedback(type);
      tapFeedbackTimerRef.current = setTimeout(() => setTapFeedback(null), 550);
    });
  }, []);

  // ─── Seek ripple helper ──────────────────────────────────────────────────
  const triggerRipple = useCallback((dir) => {
    setRipple(null);
    clearTimeout(rippleTimerRef.current);
    requestAnimationFrame(() => {
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
    setTimeout(() => { isTouchHandledRef.current = false; }, 400);

    onStageClick?.();

    const touch = e.changedTouches[0] || touchStartRef.current;
    const zone = getTapZone(touch.clientX);
    const now = Date.now();
    const prev = lastTapRef.current;

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
  const showSpinner = (isLoading || (isBuffering && playing)) && !error;
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
        ref={(el) => {
          videoRef.current = el;
          if (isCurrent && mediaRef) mediaRef.current = el;
        }}
        src={src}
        className={styles.viewerVideo}
        playsInline
        autoPlay={isCurrent}
        preload="auto"
        aria-label="Video player"
        style={{ opacity: isLoading ? 0 : 1, transition: 'opacity 0.3s ease' }}
        onDragStart={(e) => e.preventDefault()}
      />

      {/* ── Loading / Buffering spinner ───────────────────────────────────── */}
      {showSpinner && (
        <div className={styles.videoSpinnerWrap} aria-hidden="true">
          <div className={styles.videoSpinner} />
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {error && (
        <div className={styles.videoError} role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="52" height="52">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" />
            <circle cx="12" cy="16" r="0.75" fill="currentColor" stroke="none" />
          </svg>
          <span>Couldn't play this video</span>
          <button
            className={styles.videoRetryBtn}
            onClick={(e) => {
              e.stopPropagation();
              const v = videoRef.current;
              if (!v) return;
              setError(false);
              setIsLoading(true);
              v.load();
            }}
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Seek ripple (left 30% / right 30% double-tap) ──────────────────── */}
      <SeekRipple direction="left"  visible={ripple === 'left'}  />
      <SeekRipple direction="right" visible={ripple === 'right'} />

      {/* ── Center play/pause flash ──────────────────────────────────────── */}
      {tapFeedback && (
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
      {ended && (
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

      {/* ── Controls overlay ─────────────────────────────────────────────── */}
      {!error && (
        <div
          data-controls
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
              aria-valuemax={100}
              aria-valuenow={0}
              tabIndex={0}
              onMouseDown={handleProgressMouseDown}
              onMouseMove={handleProgressMouseMove}
              onMouseLeave={handleProgressMouseLeave}
              onTouchStart={handleProgressTouchStart}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft')  { e.preventDefault(); seekBy(-5); }
                if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5); }
              }}
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