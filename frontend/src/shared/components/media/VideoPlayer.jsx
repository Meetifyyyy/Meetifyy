import { useRef, useState, useEffect, useCallback } from 'react';
import styles from './VideoPlayer.module.css';

export default function VideoPlayer({ src }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimer = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false); // first play happened
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [prevVolume, setPrevVolume] = useState(1);
  const [showControls, setShowControls] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [quality, setQuality] = useState('Auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [volumeHovered, setVolumeHovered] = useState(false);
  const volumeTimer = useRef(null);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [availableQualities, setAvailableQualities] = useState(['Auto']);
  const [isChangingQuality, setIsChangingQuality] = useState(false);

  // Premium interactive feedback states & refs
  const [tapFeedback, setTapFeedback] = useState(null); // 'play' | 'pause' | null
  const tapFeedbackTimerRef = useRef(null);
  const clickTimerRef = useRef(null);

  const showVolume = useCallback(() => {
    clearTimeout(volumeTimer.current);
    setShowVolumeSlider(true);
  }, []);

  const hideVolume = useCallback(() => {
    clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => {
      setShowVolumeSlider(false);
    }, 300);
  }, []);

  useEffect(() => {
    setCurrentSrc(src);
    setQuality('Auto');
  }, [src]);

  useEffect(() => {
    if (!showQualityMenu) return;
    const handleOutside = () => setShowQualityMenu(false);
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, [showQualityMenu]);

  useEffect(() => {
    if (!isDraggingVolume) return;
    const handleMouseUp = () => {
      setIsDraggingVolume(false);
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingVolume]);

  const getQualityFilter = useCallback(() => {
    if (quality === '480p') return { filter: 'blur(1.5px) contrast(0.95)' };
    if (quality === '720p') return { filter: 'blur(0.6px)' };
    return {};
  }, [quality]);

  const handleQualityChange = useCallback((q, e) => {
    e.stopPropagation();
    if (q === quality) {
      setShowQualityMenu(false);
      return;
    }

    setQuality(q);
    setShowQualityMenu(false);
    setIsChangingQuality(true);

    const v = videoRef.current;
    if (!v) return;

    const wasPlaying = !v.paused;
    if (wasPlaying) {
      v.pause();
    }

    setTimeout(() => {
      setIsChangingQuality(false);
      if (wasPlaying) {
        v.play().catch(err => console.error('Play error on quality change:', err));
      }
    }, 400);
  }, [quality]);

  const fmt = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 2500);
  }, []);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  const togglePlay = useCallback((e) => {
    if (e) {
      e.stopPropagation();
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setStarted(true);
    } else {
      v.pause();
    }
    revealControls();
  }, [revealControls]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { 
      setPlaying(false); 
      setStarted(false); 
      setProgress(0); 
      setCurrentTime(0); 
    };
    const onTimeUpdate = () => {
      if (!isDragging) {
        setCurrentTime(v.currentTime);
        setProgress(v.duration ? (v.currentTime / v.duration) * 100 : 0);
      }
    };
    const onLoaded = () => {
      setDuration(v.duration);
      const height = v.videoHeight;
      const qualities = ['Auto'];
      if (height >= 1080) {
        qualities.unshift('1080p', '720p', '480p');
      } else if (height >= 720) {
        qualities.unshift('720p', '480p');
      } else if (height >= 480) {
        qualities.unshift('480p');
      } else if (height > 0) {
        qualities.unshift(`${height}p`);
      }
      setAvailableQualities(qualities);
      setQuality((prev) => {
        if (prev !== 'Auto' && !qualities.includes(prev)) {
          return qualities[0];
        }
        return prev;
      });
    };
    
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('loadedmetadata', onLoaded);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('loadedmetadata', onLoaded);
      clearTimeout(hideTimer.current);
      clearTimeout(volumeTimer.current);
    };
  }, [isDragging]);

  const handleSeek = useCallback((clientX) => {
    const v = videoRef.current;
    const container = containerRef.current;
    if (!v || !container) return;
    const bar = container.querySelector(`.${styles.progressWrap}`);
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    setProgress(pct * 100);
    setCurrentTime(pct * v.duration);
  }, []);

  const handleMouseDown = (e) => {
    e.stopPropagation();
    setIsDragging(true);
    handleSeek(e.clientX);
    revealControls();
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      handleSeek(e.clientX);
      revealControls();
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleSeek, revealControls]);

  const toggleMute = (e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    
    if (v.muted || muted) {
      v.muted = false;
      setMuted(false);
      v.volume = prevVolume;
      setVolume(prevVolume);
    } else {
      setPrevVolume(volume);
      v.muted = true;
      setMuted(true);
      setVolume(0);
    }
    revealControls();
  };

  const handleVolumeChange = (e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    setVolume(val);
    v.volume = val;
    if (val === 0) {
      v.muted = true;
      setMuted(true);
    } else {
      v.muted = false;
      setMuted(false);
      setPrevVolume(val);
    }
    revealControls();
  };

  const toggleFullscreen = (e) => {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  };

  const handleVideoDoubleClick = (e) => {
    e.stopPropagation();
    toggleFullscreen(e);
  };

  const getVolumeIcon = () => {
    if (muted || volume === 0) {
      return (
        <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
          <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
        </svg>
      );
    }
    if (volume < 0.5) {
      return (
        <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    );
  };

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onMouseMove={started ? revealControls : undefined}
      onMouseLeave={() => {
        if (started) {
          setShowControls(false);
          clearTimeout(hideTimer.current);
        }
      }}
      onClick={togglePlay}
      onDoubleClick={handleVideoDoubleClick}
    >
      <video
        ref={videoRef}
        src={currentSrc}
        className={styles.video}
        style={getQualityFilter()}
        playsInline
        controlsList="nodownload"
        disablePictureInPicture
      />

      {/* Quality change buffer simulation */}
      {isChangingQuality && (
        <div className={styles.qualitySpinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}

      {/* Big centre play button — shown before first play */}
      {!started && (
        <div className={styles.bigPlay}>
          <div className={styles.bigPlayCircle}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28" style={{ marginLeft: '2px' }}>
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}
      {/* Mini Duration — visible on left side when controls are hidden */}
      {started && (
        <div className={`${styles.miniDuration} ${!showControls ? styles.miniDurationVisible : ''}`}>
          {fmt(currentTime)}
        </div>
      )}

      {/* Bottom control bar — shown after first play on hover */}
      {started && (
        <div className={`${styles.controls} ${showControls ? styles.visible : ''}`}
          onClick={e => e.stopPropagation()}>

          {/* Progress bar */}
          <div className={styles.progressWrap} onMouseDown={handleMouseDown}>
            <div className={styles.progressBg} />
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            <div className={styles.progressThumb} style={{ left: `${progress}%` }} />
          </div>

          <div className={styles.row}>
            {/* Play / Pause */}
            <button className={styles.btn} onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
              {playing ? (
                <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
                  <path d="M6 19h4V5H6zm8-14v14h4V5z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>

            {/* Volume Container */}
            <div className={styles.volumeContainer}>
              <button 
                className={styles.btn} 
                onClick={toggleMute} 
                title={muted ? 'Unmute' : 'Mute'}
                onMouseEnter={showVolume}
                onMouseLeave={hideVolume}
              >
                {getVolumeIcon()}
              </button>
              <div 
                className={`${styles.volumeSliderWrap} ${showVolumeSlider || isDraggingVolume ? styles.sliderVisible : ''}`} 
                onClick={e => e.stopPropagation()}
                onMouseEnter={showVolume}
                onMouseLeave={hideVolume}
              >
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.05" 
                  value={muted ? 0 : volume} 
                  onChange={handleVolumeChange}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsDraggingVolume(true);
                  }}
                  className={styles.volumeSlider}
                />
              </div>
            </div>

            {/* Time */}
            <span className={styles.time}>{fmt(currentTime)} / {fmt(duration)}</span>

            <div className={styles.spacer} />

            {/* Quality Selector */}
            <div className={styles.qualityContainer}>
              <button 
                className={styles.qualityBtn} 
                onClick={(e) => { e.stopPropagation(); setShowQualityMenu(!showQualityMenu); }}
                title="Video Quality"
              >
                <span>{quality}</span>
              </button>
              {showQualityMenu && (
                <div className={styles.qualityMenu}>
                  {availableQualities.map((q) => (
                    <button
                      key={q}
                      className={`${styles.qualityMenuItem} ${quality === q ? styles.activeQuality : ''}`}
                      onClick={(e) => handleQualityChange(q, e)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen */}
            <button className={styles.btn} onClick={toggleFullscreen} title="Fullscreen">
              <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
