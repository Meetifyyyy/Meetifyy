import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import styles from './MediaViewer.module.css';

// ─── Constants ───────────────────────────────────────────────────────────────
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const HIDE_DELAY_MS = 2800;
const SEEK_TOOLTIP_WIDTH = 52;
const VOLUME_KEY = '__mv_volume__';
const DOUBLE_TAP_MS = 300;

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

// ─── Icons (inline SVG, no external dependency) ──────────────────────────────
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" aria-hidden="true">
    <path d="M6 19h4V5H6zm8-14v14h4V5z" />
  </svg>
);
const ReplayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" aria-hidden="true">
    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
  </svg>
);
const VolumeHighIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
);
const VolumeLowIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
  </svg>
);
const VolumeMuteIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
  </svg>
);
const FullscreenEnterIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
  </svg>
);
const FullscreenExitIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
    <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
  </svg>
);
// ─── Seek Ripple ──────────────────────────────────────────────────────────────
function SeekRipple({ direction, visible }) {
  if (!visible) return null;
  return (
    <div className={`${styles.seekRipple} ${direction === 'left' ? styles.seekRippleLeft : styles.seekRippleRight}`}>
      <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
        {direction === 'left'
          ? <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
          : <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />}
      </svg>
      <span className={styles.seekRippleLabel}>{direction === 'left' ? '-10s' : '+10s'}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function VideoViewer({ src, onControlsChange }) {
  const wrapRef       = useRef(null);
  const videoRef      = useRef(null);
  const progressRef   = useRef(null);
  const hideTimerRef  = useRef(null);
  const rafRef        = useRef(null);
  const lastTapRef    = useRef({ time: 0, x: 0 });

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

  useEffect(() => {
    if (onControlsChange) onControlsChange(ctrlVisible);
  }, [ctrlVisible, onControlsChange]);

  // ── Hover tooltip on progress bar ──────────────────────────────────────────
  const [hoverTime, setHoverTime]     = useState(null);    // seconds
  const [hoverX, setHoverX]           = useState(0);       // px from left of bar

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
  const clickTimerRef                   = useRef(null);

  // ─── Auto-hide helpers ──────────────────────────────────────────────────────
  const showControls = useCallback(() => {
    setCtrlVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setCtrlVisible(false);
    }, HIDE_DELAY_MS);
  }, []);

  const keepControls = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    setCtrlVisible(true);
  }, []);

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
        // If autoplay is blocked by browser policy, try muted autoplay
        if (err.name === 'NotAllowedError') {
          v.muted = true;
          setMuted(true);
          v.play().catch((err2) => {
            console.warn('Muted autoplay also blocked:', err2);
          });
        } else if (err.name !== 'AbortError') {
          // Ignore AbortError, other errors set error state
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

    const onPlay         = () => { setPlaying(true);  setEnded(false); startProgressLoop(); };
    const onPause        = () => { setPlaying(false); stopProgressLoop(); };
    const onEnded        = () => { setPlaying(false); setEnded(true);  stopProgressLoop(); keepControls(); };
    const onWaiting      = () => setIsBuf(true);
    const onPlaying      = () => setIsBuf(false);
    const onCanPlay      = () => { setIsLoading(false); setIsBuf(false); };
    const onLoadedMeta   = () => { setDuration(v.duration); setIsLoading(false); };
    const onLoadStart    = () => { setIsLoading(true); setError(false); };
    const onError        = () => {
      setIsLoading(false);
      setError(true);
    };
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
    };
  }, [src, startProgressLoop, stopProgressLoop, keepControls]);

  // ─── Pause & cleanup on unmount only ───────────────────────────────────────
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v) {
        v.pause();
      }
      stopProgressLoop();
      clearTimeout(hideTimerRef.current);
      clearTimeout(rippleTimerRef.current);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [stopProgressLoop]);
  // ─── Playback actions ─────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
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
  }, []);

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
    keepControls();
    const frac = getSeekFraction(e.clientX);
    commitSeek(frac);
  }, [getSeekFraction, commitSeek, keepControls]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e) => {
      const frac = getSeekFraction(e.clientX);
      commitSeek(frac);
    };
    const onUp = () => setIsDragging(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, getSeekFraction, commitSeek]);

  useEffect(() => {
    if (!isDragging) showControls();
  }, [isDragging]);

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
    keepControls();
    commitSeek(getSeekFraction(touch.clientX));
  }, [getSeekFraction, commitSeek, keepControls]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e) => {
      const touch = e.touches[0];
      if (touch) commitSeek(getSeekFraction(touch.clientX));
    };
    const onEnd = () => setIsDragging(false);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [isDragging, getSeekFraction, commitSeek]);

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
      tapFeedbackTimerRef.current = setTimeout(() => setTapFeedback(null), 600);
    });
  }, []);

  // ─── Mobile touch handling (single-tap → play/pause, double-tap → seek) ──
  const triggerRipple = useCallback((dir) => {
    setRipple(dir);
    clearTimeout(rippleTimerRef.current);
    rippleTimerRef.current = setTimeout(() => setRipple(null), 700);
  }, []);

  const handleWrapTouch = useCallback((e) => {
    if (e.target.closest('[data-controls]')) return;
    // Prevent synthetic click; mobile touch is handled entirely here
    e.preventDefault();
    handleActivity();

    const now   = Date.now();
    const touch = e.touches[0];
    const prev  = lastTapRef.current;

    if (now - prev.time < DOUBLE_TAP_MS && Math.abs(touch.clientX - prev.x) < 30) {
      // Double-tap → seek ±10s, cancel pending single-tap
      clearTimeout(clickTimerRef.current);
      const isLeft = touch.clientX < window.innerWidth / 2;
      seekBy(isLeft ? -10 : 10);
      triggerRipple(isLeft ? 'left' : 'right');
      lastTapRef.current = { time: 0, x: 0 };
    } else {
      // First tap → schedule play/pause after double-tap window
      lastTapRef.current = { time: now, x: touch.clientX };
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        const v = videoRef.current;
        const willPlay = v ? (v.paused || v.ended) : !playing;
        togglePlay();
        triggerTapFeedback(willPlay ? 'play' : 'pause');
      }, DOUBLE_TAP_MS + 20);
    }
  }, [handleActivity, seekBy, triggerRipple, togglePlay, triggerTapFeedback, playing]);

  // ─── Click/Click handler on wrap (desktop) — fires for clicks on video OR wrap ──
  const handleWrapClick = useCallback((e) => {
    // If clicking on controls, let them handle it
    if (e.target.closest('[data-controls]')) return;
    // Don't let this bubble to the overlay's close handler
    e.stopPropagation();
    handleActivity();
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      const willPlay = v ? (v.paused || v.ended) : !playing;
      togglePlay();
      triggerTapFeedback(willPlay ? 'play' : 'pause');
    }, 250);
  }, [togglePlay, handleActivity, triggerTapFeedback, playing]);

  // ─── Double-click on wrap → fullscreen ─────────────────────────────────────
  const handleWrapDoubleClick = useCallback((e) => {
    if (e.target.closest('[data-controls]')) return;
    e.stopPropagation();
    clearTimeout(clickTimerRef.current);
    toggleFullscreen();
  }, [toggleFullscreen]);

  // ─── Volume display helpers ───────────────────────────────────────────────
  const effectiveVolume = muted ? 0 : volume;
  const VolumeIcon = effectiveVolume === 0
    ? VolumeMuteIcon
    : effectiveVolume < 0.5
      ? VolumeLowIcon
      : VolumeHighIcon;

  const showSpinner = (isLoading || (isBuffering && playing)) && !error;
  const hasDuration = duration > 0 && isFinite(duration);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapRef}
      className={styles.videoWrap}
      onMouseMove={handleActivity}
      onClick={handleWrapClick}
      onDoubleClick={handleWrapDoubleClick}
      onTouchStart={handleWrapTouch}
      data-fullscreen={isFullscreen || undefined}
    >
      {/* ── Video element — no click/dblclick handlers; events bubble to wrap ── */}
      <video
        ref={videoRef}
        src={src}
        className={styles.viewerVideo}
        playsInline
        autoPlay
        preload="auto"
        aria-label="Video player"
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

      {/* ── Seek ripple ───────────────────────────────────────────────────── */}
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
                className={styles.videoBtn}
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                aria-label={ended ? 'Replay' : playing ? 'Pause' : 'Play'}
                title={ended ? 'Replay (K)' : playing ? 'Pause (K)' : 'Play (K)'}
              >
                {ended ? <ReplayIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <div className={styles.videoVolGroup}>
                <button
                  className={styles.videoBtn}
                  onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                  aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
                  title="Mute (M)"
                >
                  <VolumeIcon />
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
                {isFullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
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