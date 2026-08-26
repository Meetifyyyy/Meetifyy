import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { getMediaUrl } from '@shared/api/apiClient';
import styles from './VoiceMessagePlayer.module.css';

// Global cache for audio durations so we never recalculate or lose durations on re-renders
const durationCache = new Map();

// Global tracker for currently playing audio to prevent multiple voice notes playing at once
let activeAudioInstance = null;

// Total bars in the waveform
const NUM_BARS = 30;

// Deterministically generate dynamic natural waveform bars from an audio source
const getWaveformBars = (seedStr) => {
  const bars = [];
  let seed = 0;
  for (let i = 0; i < (seedStr || '').length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) & 0xffffffff;
  }
  for (let i = 0; i < NUM_BARS; i++) {
    const pseudo = Math.abs(Math.sin((i + 1) * 0.48 + (seed % 100) * 0.12));
    const pseudo2 = Math.abs(Math.cos((i + 1) * 0.85 + (seed % 50) * 0.08));
    const height = Math.round(28 + 72 * (0.65 * pseudo + 0.35 * pseudo2));
    bars.push(Math.max(24, Math.min(100, height)));
  }
  return bars;
};

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

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
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

  const bars = useMemo(() => getWaveformBars(rawSrc || ''), [rawSrc]);

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
        setCurrentTime(audioRef.current.currentTime);
        if (audioRef.current.duration && isFinite(audioRef.current.duration) && audioRef.current.duration !== duration) {
          setDuration(audioRef.current.duration);
          if (audioSrc) durationCache.set(audioSrc, audioRef.current.duration);
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
  }, [isPlaying, duration, audioSrc]);

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
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  // Interactive seeking calculation
  const seekToRatio = (ratio) => {
    const targetRatio = Math.max(0, Math.min(1, ratio));
    const targetTime = targetRatio * (duration || 0);
    if (isFinite(targetTime)) {
      setCurrentTime(targetTime);
      if (audioRef.current) {
        audioRef.current.currentTime = targetTime;
      }
    }
  };

  const seekFromPointerEvent = (e) => {
    if (!waveformRef.current) return;
    const rect = waveformRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;
    seekToRatio(ratio);
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
      const nextTime = Math.min(duration || 0, currentTime + 2);
      if (audioRef.current) audioRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevTime = Math.max(0, currentTime - 2);
      if (audioRef.current) audioRef.current.currentTime = prevTime;
      setCurrentTime(prevTime);
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

  const isValidSource = Boolean(audioSrc && !isInvalidBlob);
  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const activeBarCount = Math.round(progressRatio * NUM_BARS);

  // Time label: full duration when idle, progress when seeked but paused
  const idleDisplayTime = currentTime > 0 ? formatTime(currentTime) : formatTime(duration);

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

      {/* 1. Left: Play/Pause Button (vertically centered) */}
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

      {/* 2. Center: Waveform (vertically centered) */}
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
        aria-valuenow={currentTime}
        aria-valuemin="0"
        aria-valuemax={duration || 0}
        tabIndex="0"
      >
        <div className={styles.waveformBars}>
          {bars.map((height, idx) => {
            const isActive = idx < activeBarCount;
            return (
              <div
                key={idx}
                className={`${styles.waveformBar} ${isActive ? styles.waveformBarActive : styles.waveformBarInactive}`}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>
      </div>

      {/* 3. Right: Timing when not playing OR Fixed-Width Playback Speed button while playing */}
      <div className={styles.voiceRightSlot}>
        {isPlaying ? (
          <button
            type="button"
            className={styles.voiceSpeedBtn}
            onClick={toggleSpeed}
            title="Playback speed"
            aria-label={`Playback speed ${playbackSpeed}x`}
          >
            {playbackSpeed}x
          </button>
        ) : (
          <span className={styles.voiceTimeText}>
            {idleDisplayTime}
          </span>
        )}
      </div>
    </div>
  );
}
