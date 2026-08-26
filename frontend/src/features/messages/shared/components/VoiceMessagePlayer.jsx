import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getMediaUrl } from '@shared/api/apiClient';
import styles from './VoiceMessagePlayer.module.css';

// Global cache for audio durations so we never recalculate or lose durations on re-renders
const durationCache = new Map();

// Global cache for waveform bars
const waveformCache = new Map();

// Global tracker for currently playing audio to prevent multiple voice notes playing at once
let activeAudioInstance = null;

// Total bars in the waveform
const NUM_BARS = 32;

// Deterministically generate dynamic natural waveform bars from an audio source
const getWaveformBars = (seedStr) => {
  if (!seedStr) {
    return [32, 48, 64, 82, 55, 72, 95, 68, 42, 58, 76, 92, 64, 88, 100, 72, 54, 68, 84, 48, 62, 92, 78, 58, 72, 88, 62, 44, 52, 38, 28, 22];
  }
  if (waveformCache.has(seedStr)) {
    return waveformCache.get(seedStr);
  }

  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = ((hash << 5) - hash + seedStr.charCodeAt(i)) | 0;
  }
  const seed = Math.abs(hash);

  const bars = [];
  for (let i = 0; i < NUM_BARS; i++) {
    const norm = i / (NUM_BARS - 1);
    const envelope = Math.sin(norm * Math.PI) * 0.45 + 0.55;

    const wave1 = Math.sin((i + 1) * 0.58 + (seed % 97) * 0.11);
    const wave2 = Math.cos((i + 1) * 0.92 + (seed % 67) * 0.14);
    const wave3 = Math.sin((i + 1) * 1.55 + (seed % 43) * 0.07);

    const raw = Math.abs(0.5 * wave1 + 0.35 * wave2 + 0.15 * wave3);
    const modulated = raw * envelope;
    
    // Scale between 22% and 100%
    const heightPercent = Math.round(22 + 78 * Math.max(0, Math.min(1, modulated)));
    bars.push(heightPercent);
  }

  waveformCache.set(seedStr, bars);
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

  // Foreground bars layer ref: progress is painted through clipPath, never through 60fps React state
  const fillRef = useRef(null);
  const currentTimeRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
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
  const [waveformBars, setWaveformBars] = useState(() => getWaveformBars(rawSrc || ''));

  const isValidSource = Boolean(audioSrc && !isInvalidBlob);

  const durationRef = useRef(duration);
  durationRef.current = duration;

  // Asynchronously extract real audio waveform peaks if available, else keep deterministic pattern
  useEffect(() => {
    setWaveformBars(getWaveformBars(rawSrc || ''));
    if (!audioSrc) return;

    const cacheKey = `real_${audioSrc}`;
    if (waveformCache.has(cacheKey)) {
      setWaveformBars(waveformCache.get(cacheKey));
      return;
    }

    let isMounted = true;
    const extractRealPeaks = async () => {
      try {
        const response = await fetch(audioSrc);
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const audioCtx = new AudioCtx();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const rawData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(rawData.length / NUM_BARS);
        if (blockSize <= 0) {
          audioCtx.close();
          return;
        }

        const realBars = [];
        let maxVal = 0;
        for (let i = 0; i < NUM_BARS; i++) {
          const start = i * blockSize;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[start + j] || 0);
          }
          const avg = sum / blockSize;
          realBars.push(avg);
          if (avg > maxVal) maxVal = avg;
        }

        if (maxVal > 0 && isMounted) {
          const normalized = realBars.map((val) => {
            const ratio = val / maxVal;
            return Math.round(22 + 78 * Math.pow(ratio, 0.65));
          });
          waveformCache.set(cacheKey, normalized);
          setWaveformBars(normalized);
        }
        audioCtx.close();
      } catch (_) {
        // Fallback is already active with getWaveformBars
      }
    };

    extractRealPeaks();
    return () => {
      isMounted = false;
    };
  }, [audioSrc, rawSrc]);

  /** Writes the playhead straight to the DOM via clip-path. No React re-renders involved. */
  const paintProgress = useCallback((ratio) => {
    const pct = Math.max(0, Math.min(100, (ratio || 0) * 100));
    if (fillRef.current) {
      fillRef.current.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    }
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

  // Repaint when duration or bars change
  useEffect(() => {
    paintProgress(duration > 0 ? currentTimeRef.current / duration : 0);
  }, [duration, waveformBars, paintProgress]);

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
      seekToRatio((currentTimeRef.current + 2) / (durationRef.current || 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekToRatio((currentTimeRef.current - 2) / (durationRef.current || 1));
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

      {/* Centre: dynamic waveform bars with time read-out cleanly below */}
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
            {/* Inactive background bars */}
            <div className={styles.waveBarsBackground}>
              {waveformBars.map((height, idx) => (
                <span
                  key={idx}
                  className={styles.waveBar}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>

            {/* Active foreground bars - smoothly clipped by playback progress */}
            <div
              ref={fillRef}
              className={styles.waveBarsForeground}
              style={{ clipPath: 'inset(0 100% 0 0)' }}
            >
              {waveformBars.map((height, idx) => (
                <span
                  key={idx}
                  className={styles.waveBar}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className={styles.voiceMeta}>
          <span className={styles.voiceTimeText}>
            {hasProgress ? `${formatTime(displaySec)} / ${formatTime(duration)}` : formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Right: speed */}
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
