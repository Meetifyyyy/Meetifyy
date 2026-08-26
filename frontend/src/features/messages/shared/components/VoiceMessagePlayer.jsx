import { useState, useRef, useEffect, useCallback } from 'react';
import { getMediaUrl } from '@shared/api/apiClient';
import styles from './VoiceMessagePlayer.module.css';

// Global cache for audio durations so we never recalculate or lose durations on re-renders
const durationCache = new Map();

// Global tracker for currently playing audio to prevent multiple voice notes playing at once
let activeAudioInstance = null;

// Progress is expressed as a percentage of the track's own width, so the line
// needs no fixed geometry and scales with whatever space the layout gives it.
const formatTime = (secs) => {
  if (!secs || isNaN(secs) || !isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export default function VoiceMessagePlayer({ src, audioUrl, duration: initialDuration, fromMe, isMe }) {
  const rawSrc = src || audioUrl;
  const audioSrc = rawSrc ? getMediaUrl(rawSrc) : '';
  const isFromMe = fromMe ?? isMe;

  const audioRef = useRef(null);
  const animationRef = useRef(null);
  const waveformRef = useRef(null);
  const isDraggingRef = useRef(false);

  // Progress is painted through these refs, never through React state. The
  // playhead moves 60 times a second; re-rendering the whole bubble that often
  // is what made the time label and speed pill shimmer.
  const fillRef = useRef(null);
  const handleRef = useRef(null);
  const currentTimeRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  // Whole seconds only — the label can't change more often than that, so this
  // re-renders at most once per second instead of once per frame.
  const [displaySec, setDisplaySec] = useState(0);
  const [duration, setDuration] = useState(() => {
    if (initialDuration && isFinite(initialDuration) && initialDuration > 0) {
      return Number(initialDuration);
    }
    if (audioSrc && durationCache.has(audioSrc)) {
      return durationCache.get(audioSrc);
    }
    return 0;
  });
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isInvalidBlob, setIsInvalidBlob] = useState(false);

  const isValidSource = Boolean(audioSrc && !isInvalidBlob);

  // Keep the duration ref-readable inside the animation loop without making it
  // a dependency of every callback.
  const durationRef = useRef(duration);
  durationRef.current = duration;

  /** Writes the playhead straight to the DOM. No React involved. */
  const paintProgress = useCallback((ratio) => {
    const pct = `${Math.max(0, Math.min(1, ratio || 0)) * 100}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (handleRef.current) handleRef.current.style.left = pct;
  }, []);

  const syncTime = useCallback((time) => {
    currentTimeRef.current = time;
    const d = durationRef.current;
    paintProgress(d > 0 ? time / d : 0);
    const whole = Math.floor(time);
    setDisplaySec((prev) => (prev === whole ? prev : whole));
  }, [paintProgress]);

  // Sync initial duration if provided or cached
  useEffect(() => {
    if (initialDuration && isFinite(initialDuration) && initialDuration > 0) {
      const num = Number(initialDuration);
      setDuration(num);
      if (audioSrc) durationCache.set(audioSrc, num);
    } else if (audioSrc && durationCache.has(audioSrc)) {
      setDuration(durationCache.get(audioSrc));
    }
  }, [initialDuration, audioSrc]);

  // Clean duration extractor that solves Chrome WebM Infinity bug
  const extractDuration = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const d = audio.duration;
    if (isFinite(d) && d > 0) {
      setDuration(d);
      if (audioSrc) durationCache.set(audioSrc, d);
    } else if (d === Infinity) {
      // Workaround for WebM without duration header in Chrome
      const onTimeUpdateForDuration = () => {
        audio.removeEventListener('timeupdate', onTimeUpdateForDuration);
        const realDuration = audio.duration;
        if (isFinite(realDuration) && realDuration > 0) {
          setDuration(realDuration);
          if (audioSrc) durationCache.set(audioSrc, realDuration);
        }
        audio.currentTime = 0;
      };
      audio.addEventListener('timeupdate', onTimeUpdateForDuration);
      audio.currentTime = 1e101;
    }
  }, [audioSrc]);

  // Animation frame loop for 60fps smooth playback progress
  useEffect(() => {
    const updateProgress = () => {
      if (audioRef.current && isPlaying && !isDraggingRef.current) {
        syncTime(audioRef.current.currentTime);
        const d = audioRef.current.duration;
        if (d && isFinite(d) && d !== durationRef.current) {
          setDuration(d);
          if (audioSrc) durationCache.set(audioSrc, d);
        }
        animationRef.current = requestAnimationFrame(updateProgress);
      }
    };

    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateProgress);
    } else if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isPlaying, audioSrc, syncTime]);

  // Repaint when the duration lands after the fact (metadata arrives late), so
  // an already-seeked playhead sits at the right spot.
  useEffect(() => {
    paintProgress(duration > 0 ? currentTimeRef.current / duration : 0);
  }, [duration, paintProgress]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        if (activeAudioInstance === audioRef.current) {
          activeAudioInstance = null;
        }
        audioRef.current.pause();
      }
    };
  }, []);

  const togglePlay = async () => {
    if (!audioRef.current || !isValidSource) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (activeAudioInstance && activeAudioInstance !== audioRef.current) {
        activeAudioInstance.pause();
      }
      activeAudioInstance = audioRef.current;

      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Audio playback error:', err);
        }
        setIsPlaying(false);
      }
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && !isPlaying && !isDraggingRef.current) {
      syncTime(audioRef.current.currentTime);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    syncTime(0);
  };

  // Interactive seeking calculation
  const seekToRatio = (ratio) => {
    const targetRatio = Math.max(0, Math.min(1, ratio));
    const targetTime = targetRatio * (durationRef.current || 0);
    if (isFinite(targetTime)) {
      if (audioRef.current) {
        audioRef.current.currentTime = targetTime;
      }
      syncTime(targetTime);
    }
  };

  const seekFromPointerEvent = (e) => {
    if (!waveformRef.current) return;
    const rect = waveformRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = e.clientX - rect.left;
    seekToRatio(clickX / rect.width);
  };

  const handlePointerDown = (e) => {
    if (!isValidSource) return;
    isDraggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    seekFromPointerEvent(e);
  };

  const handlePointerMove = (e) => {
    if (isDraggingRef.current) {
      seekFromPointerEvent(e);
    }
  };

  const handlePointerUp = (e) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  };

  const handleKeyDown = (e) => {
    if (!isValidSource) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      seekToRatio(((currentTimeRef.current + 2) / (durationRef.current || 1)));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekToRatio(((currentTimeRef.current - 2) / (durationRef.current || 1)));
    }
  };

  const toggleSpeed = (e) => {
    e.stopPropagation();
    const speeds = [1, 1.5, 2];
    const nextIndex = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIndex];
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  // Idle shows the full length; once playing or scrubbed it shows the position
  // against that length, so the label never loses the total.
  const hasProgress = isPlaying || displaySec > 0;
  return (
    <div className={`${styles.voicePlayerContainer} ${isFromMe ? styles.voicePlayerMe : styles.voicePlayerThem}`}>
      {isValidSource && (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={extractDuration}
          onDurationChange={extractDuration}
          onCanPlay={extractDuration}
          onEnded={handleEnded}
          onPause={() => setIsPlaying(false)}
          onError={() => {
            setIsPlaying(false);
            setIsInvalidBlob(true);
          }}
        />
      )}

      {/* Left: play / pause */}
      <button
        type="button"
        className={styles.voicePlayBtn}
        onClick={togglePlay}
        disabled={!isValidSource}
        title={!isValidSource ? 'Audio unavailable' : isPlaying ? 'Pause' : 'Play'}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
      >
        {isPlaying ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1.5" />
            <rect x="14" y="4" width="4" height="16" rx="1.5" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
            <path d="M6 4l14 8-14 8V4z" />
          </svg>
        )}
      </button>

      {/* Centre: line waveform above the time read-out */}
      <div className={styles.voiceCenter}>
        <div
          ref={waveformRef}
          className={styles.waveformContainer}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          role="slider"
          aria-label="Audio playback scrubber"
          aria-valuenow={displaySec}
          aria-valuemin="0"
          aria-valuetext={`${formatTime(displaySec)} of ${formatTime(duration)}`}
          aria-valuemax={Math.floor(duration || 0)}
          tabIndex="0"
        >
          <div className={styles.waveTrack} aria-hidden="true">
            <div className={styles.waveLine} />
            {/* Only these two inline styles change as playback advances — one
                write each per frame, no React reconciliation. */}
            <div ref={fillRef} className={styles.waveFill} style={{ width: '0%' }} />
            <div ref={handleRef} className={styles.waveHandle} style={{ left: '0%' }} />
          </div>
        </div>

        <div className={styles.voiceMeta}>
          <span className={styles.voiceTimeText}>
            {hasProgress ? `${formatTime(displaySec)} / ${formatTime(duration)}` : formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Right: speed. Always mounted at a fixed width, so switching between
          play and pause can never reflow the waveform beside it. */}
      <button
        type="button"
        className={styles.voiceSpeedBtn}
        onClick={toggleSpeed}
        disabled={!isValidSource}
        title="Playback speed"
        aria-label={`Playback speed ${playbackSpeed}x`}
      >
        {playbackSpeed}×
      </button>
    </div>
  );
}
