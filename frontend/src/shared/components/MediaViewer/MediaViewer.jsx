import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { showToast } from '@shared/utils/toast';
import ImageViewer from './ImageViewer';
import VideoViewer from './VideoViewer';
import styles from './MediaViewer.module.css';
import ReportModal from '@shared/components/modals/ReportModal/ReportModal';
import ForwardMessageModal from '@features/messages/shared/components/modals/ForwardMessageModal';
import { useRecipientConversations } from '@shared/hooks/useRecipientConversations';
import { useMessageActions } from '@shared/hooks/useMessageActions';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Forward,
  MoreVertical,
  Download,
  Share,
  Flag,
  Trash2,
} from '@shared/components/icons';

/** Detect video items by explicit type field OR URL extension. */
function isVideo(item) {
  if (!item) return false;
  // Explicit type always wins
  if (item.type === 'video') return true;
  if (item.type === 'image') return false;
  // Fall back to URL sniff for legacy callers
  const url = (item.url || '').toLowerCase().split('?')[0];
  return /\.(mp4|webm|mov|mkv|avi|flv|m4v|ogv)$/.test(url);
}

// ── Gesture constants ──────────────────────────────────────────────────────────
/** Minimum pointer movement (px) before we lock the gesture axis. */
const AXIS_LOCK_THRESHOLD = 10;
/** Horizontal: fraction of viewport width that triggers navigate. */
const SWIPE_DISTANCE_THRESHOLD = 0.25;
/** Horizontal: pointer speed (px/ms) that triggers navigate even if distance is short. */
const SWIPE_VELOCITY_THRESHOLD = 0.45;
/** Horizontal boundary resistance factor (0–1). Lower = more rubbery. */
const BOUNDARY_RESISTANCE = 0.3;
/** Vertical: fraction of viewport height that triggers dismiss. */
const DISMISS_DISTANCE_THRESHOLD = 0.30;
/** Vertical: pointer speed (px/ms) that triggers dismiss. */
const DISMISS_VELOCITY_THRESHOLD = 0.70;
/** Vertical: minimum absolute distance (px) before velocity alone can dismiss. */
const DISMISS_MIN_FOR_VELOCITY = 40;
/** Vertical: damping applied to raw drag delta during dismiss gesture. */
const DISMISS_DRAG_DAMPEN = 0.88;

export default function MediaViewer() {
  const { state, closeViewer, navigate, savedScrollRef } = useMediaViewer();
  const { open, items, index, meta } = state;

  const overlayRef  = useRef(null);
  const stageRef    = useRef(null);
  const trackRef    = useRef(null);
  /** Ref forwarded to the media element (img or video) for vertical drag. */
  const mediaElRef  = useRef(null);

  const [visible, setVisible]               = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showMoreMenu, setShowMoreMenu]     = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [hasReported, setHasReported]       = useState(false);
  const [downloadState, setDownloadState]   = useState(null);
  const downloadAbortRef = useRef(null);
  const didClose = useRef(false);

  const handleClose = useCallback(() => {
    setVisible(false);
    controlsHiddenByGesture.current = false;
    // Pause all feed videos (below MediaViewer priority 10) on close
    if (typeof window !== 'undefined') {
      import('@shared/utils/feedVideoRegistry')
        .then(({ feedVideoRegistry: r }) => r.pauseAll(10))
        .catch(() => {});
    }
    setTimeout(closeViewer, 280);
  }, [closeViewer]);

  useOverlayBack(open, handleClose);
  useScrollLock(open);

  const currentItem = items[index] || null;
  const prevItem    = items[index - 1] || null;
  const nextItem    = items[index + 1] || null;
  const isVid       = isVideo(currentItem);

  // Keep index in a ref so gesture callbacks always see the latest value
  // without needing to be recreated on every index change.
  const indexRef      = useRef(index);
  const itemsLenRef   = useRef(items.length);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { itemsLenRef.current = items.length; }, [items.length]);

  // Ref to mirror controlsVisible without causing gesture-path re-renders
  const controlsVisibleRef     = useRef(true);
  const controlsHiddenByGesture = useRef(false);

  // ── Smart adjacent image preloading (immediate async decode, memory-safe) ──
  const preloadImgsRef = useRef([]);
  useEffect(() => {
    if (!open || !items || items.length <= 1) return;

    // Clear previous preloads
    preloadImgsRef.current.forEach((img) => { img.src = ''; });
    preloadImgsRef.current = [];

    const candidates = [items[index + 1], items[index - 1]].filter(
      (item) => item && item.url && !isVideo(item),
    );
    if (candidates.length === 0) return;

    candidates.forEach((item) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = item.url;
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {});
      }
      preloadImgsRef.current.push(img);
    });

    return () => {
      preloadImgsRef.current.forEach((img) => { img.src = ''; });
      preloadImgsRef.current = [];
    };
  }, [open, items, index]);


  // ── Open / close animation ──────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      didClose.current = false;
      setControlsVisible(true);
      if (trackRef.current) {
        trackRef.current.style.transition = 'none';
        trackRef.current.style.transform = `translate3d(-${index * 100}%, 0, 0)`;
      }
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

  // Sync track position smoothly when index changes
  useEffect(() => {
    if (!open) return;
    if (trackRef.current && !gestureRef.current.active) {
      trackRef.current.style.transition = 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      trackRef.current.style.transform  = `translate3d(-${index * 100}%, 0, 0)`;
    }
  }, [index, open]);

  useEffect(() => {
    if (!open && !didClose.current) {
      didClose.current = true;
      const timer = setTimeout(() => {
        window.scrollTo(0, savedScrollRef.current || 0);
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // ── Close more menu on outside click ───────────────────────────────────────
  useEffect(() => {
    if (!showMoreMenu) return;
    const handle = (e) => {
      if (e.target.closest(`.${styles.moreMenuWrap}`)) return;
      setShowMoreMenu(false);
    };
    window.addEventListener('click', handle, true);
    window.addEventListener('pointerdown', handle, true);
    return () => {
      window.removeEventListener('click', handle, true);
      window.removeEventListener('pointerdown', handle, true);
    };
  }, [showMoreMenu]);

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') { handleClose(); return; }
      if (isVid) return;
      if (e.key === 'ArrowLeft')  navigate(-1);
      if (e.key === 'ArrowRight') navigate(1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, navigate, isVid, handleClose]);

  // ── Focus trap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) overlayRef.current?.focus();
  }, [open]);

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIFIED GESTURE SYSTEM
  //
  // One single state machine handles all drag/swipe interactions. The machine
  // lives in a ref (no React state re-renders during active gesture) for
  // 60fps performance.
  //
  // Priority:
  //   Tap / tiny movement (<AXIS_LOCK_THRESHOLD px)  →  no gesture
  //   Horizontal dominant (|dx| > |dy|)              →  swipe to navigate
  //   Vertical dominant   (|dy| > |dx|)              →  drag to dismiss
  //
  // Once axis is locked it CANNOT switch for that gesture.
  //
  // The gesture targets:
  //   H-swipe:  stageRef  (the whole media stage container)
  //   V-dismiss: mediaElRef (only the <img> or <video> element)
  //             overlay background opacity (via style, not state)
  //
  // Controls (top bar, nav buttons, info panel) are absolutely positioned
  // outside the stage or inside the overlay — they never translate with it.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} GestureState
   * @property {number}  startX
   * @property {number}  startY
   * @property {number}  startTime
   * @property {number}  lastX       - Most recent pointer X (for velocity)
   * @property {number}  lastY
   * @property {number}  lastTime
   * @property {'h'|'v'|null} axis   - null = undecided
   * @property {boolean} active
   */
  const gestureRef = useRef(/** @type {GestureState} */ ({
    startX: 0, startY: 0,
    lastX: 0,  lastY: 0,
    startTime: 0, lastTime: 0,
    axis: null,
    active: false,
  }));

  /** Reset the media element and overlay transforms after vertical dismiss gesture. */
  const resetGestureTransforms = useCallback((animated = true) => {
    const ease = animated ? 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
    if (mediaElRef.current) {
      mediaElRef.current.style.transition = ease;
      mediaElRef.current.style.transform  = '';
    }
    if (overlayRef.current) {
      overlayRef.current.style.transition = animated ? 'background-color 0.32s ease' : 'none';
      overlayRef.current.style.backgroundColor = '';
    }
    // Clear after transition so CSS classes take over again
    if (animated) {
      setTimeout(() => {
        if (mediaElRef.current) {
          mediaElRef.current.style.transition = '';
          mediaElRef.current.style.transform  = '';
        }
        if (overlayRef.current) {
          overlayRef.current.style.transition       = '';
          overlayRef.current.style.backgroundColor  = '';
        }
      }, 340);
    }
  }, []);

  /** Check whether the pointer-down target is inside a video control zone. */
  const isVideoControl = (target) => {
    return !!(
      target.closest('[data-controls]') ||
      target.closest('input[type="range"]') ||
      target.closest('[role="slider"]') ||
      target.closest('button') ||
      target.closest('[role="listbox"]') ||
      target.closest('[role="option"]') ||
      target.tagName === 'INPUT' ||
      target.tagName === 'BUTTON'
    );
  };

  const onGestureStart = useCallback((clientX, clientY, target) => {
    // Skip if already zoomed into image
    if (target.closest('[data-zoomed="true"]')) return;
    // Skip if on a video control element — video manages its own touch
    if (isVid && isVideoControl(target)) return;

    gestureRef.current = {
      startX: clientX,
      startY: clientY,
      lastX: clientX,
      lastY: clientY,
      startTime: Date.now(),
      lastTime: Date.now(),
      axis: null,
      active: true,
    };
  }, [isVid]);

  const rafIdRef = useRef(null);

  const applyGestureTransform = useCallback(() => {
    rafIdRef.current = null;
    const g = gestureRef.current;
    if (!g.active) return;

    const dx = g.lastX - g.startX;
    const dy = g.lastY - g.startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    // Axis detection — wait until user moves far enough to determine intent
    if (!g.axis) {
      if (adx < AXIS_LOCK_THRESHOLD && ady < AXIS_LOCK_THRESHOLD) return;
      g.axis = adx >= ady ? 'h' : 'v';
    }

    if (g.axis === 'h') {
      // ── Horizontal: slide track continuously ──────────────────────────────
      const idx = indexRef.current;
      const len = itemsLenRef.current;
      const atLeft  = idx === 0;
      const atRight = idx === len - 1;
      let translateX = dx;

      // Boundary resistance: rubber-band at first/last item
      if ((atLeft && dx > 0) || (atRight && dx < 0)) {
        translateX = dx * BOUNDARY_RESISTANCE;
      }

      if (trackRef.current) {
        const vw = stageRef.current?.clientWidth || window.visualViewport?.width || window.innerWidth;
        const totalX = -idx * vw + translateX;
        trackRef.current.style.transition = 'none';
        trackRef.current.style.transform  = `translate3d(${totalX}px, 0, 0)`;
      }
    } else if (g.axis === 'v') {
      // ── Vertical: move only the media element ────────────────────────────
      const dampened = dy * DISMISS_DRAG_DAMPEN;
      const vh       = window.visualViewport?.height || window.innerHeight;
      const progress = Math.min(Math.abs(dampened) / (vh * 0.55), 1);
      const bgOpacity = 1 - (progress * 0.85);

      if (mediaElRef.current) {
        mediaElRef.current.style.transition = 'none';
        mediaElRef.current.style.transform  = `translate3d(0, ${dampened}px, 0)`;
      }
      if (overlayRef.current) {
        overlayRef.current.style.transition      = 'none';
        overlayRef.current.style.backgroundColor = `rgba(0,0,0,${bgOpacity})`;
      }

      // Fade controls as the user drags — one-shot ref flag (no React state in hot path)
      if (!controlsHiddenByGesture.current && Math.abs(dy) > 20) {
        controlsHiddenByGesture.current = true;
        setControlsVisible(false);
      }
    }
  }, []);

  const onGestureEnd = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const g = gestureRef.current;
    if (!g.active) return;
    g.active = false;

    // Clear will-change set during gesture start
    if (stageRef.current) stageRef.current.style.willChange = '';
    if (trackRef.current) trackRef.current.style.willChange = '';

    const dx  = g.lastX - g.startX;
    const dy  = g.lastY - g.startY;
    const dt  = Math.max(g.lastTime - g.startTime, 1);
    const vx  = Math.abs(dx) / dt;  // px/ms
    const vy  = Math.abs(dy) / dt;
    const idx = indexRef.current;
    const len = itemsLenRef.current;

    if (g.axis === 'h') {
      const vw             = stageRef.current?.clientWidth || window.visualViewport?.width || window.innerWidth;
      const distThreshold  = vw * SWIPE_DISTANCE_THRESHOLD;
      const swipeLeft      = dx < 0;
      const swipeRight     = dx > 0;
      const pastDist       = Math.abs(dx) > distThreshold;
      const pastVelocity   = vx > SWIPE_VELOCITY_THRESHOLD && Math.abs(dx) > 30;

      if ((pastDist || pastVelocity) && swipeLeft && idx < len - 1) {
        if (trackRef.current) {
          trackRef.current.style.transition = 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          trackRef.current.style.transform  = `translate3d(-${(idx + 1) * 100}%, 0, 0)`;
        }
        navigate(1);
      } else if ((pastDist || pastVelocity) && swipeRight && idx > 0) {
        if (trackRef.current) {
          trackRef.current.style.transition = 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          trackRef.current.style.transform  = `translate3d(-${(idx - 1) * 100}%, 0, 0)`;
        }
        navigate(-1);
      } else {
        if (trackRef.current) {
          trackRef.current.style.transition = 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          trackRef.current.style.transform  = `translate3d(-${idx * 100}%, 0, 0)`;
        }
      }
    } else if (g.axis === 'v') {
      const vh            = window.visualViewport?.height || window.innerHeight;
      const distThreshold = vh * DISMISS_DISTANCE_THRESHOLD;
      const absDy         = Math.abs(dy);
      const pastDist      = absDy > distThreshold;
      const pastVelocity  = vy > DISMISS_VELOCITY_THRESHOLD && absDy > DISMISS_MIN_FOR_VELOCITY;

      if (pastDist || pastVelocity) {
        // Dismiss
        const sign    = dy > 0 ? 1 : -1;
        const finishY = sign * vh;
        if (mediaElRef.current) {
          mediaElRef.current.style.transition = 'transform 0.24s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          mediaElRef.current.style.transform  = `translate3d(0, ${finishY}px, 0)`;
        }
        if (overlayRef.current) {
          overlayRef.current.style.transition       = 'background-color 0.24s ease';
          overlayRef.current.style.backgroundColor  = 'rgba(0,0,0,0)';
        }
        handleClose();
      } else {
        // Snap back
        controlsHiddenByGesture.current = false;
        setControlsVisible(true);
        resetGestureTransforms(true);
      }
    } else {
      // No axis determined — just snap back
      if (trackRef.current) {
        trackRef.current.style.transition = 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        trackRef.current.style.transform  = `translate3d(-${idx * 100}%, 0, 0)`;
      }
      resetGestureTransforms(false);
    }
  }, [navigate, handleClose, resetGestureTransforms]);

  // ── Touch events (touch-only: desktop mouse drag navigation is disabled) ──
  const handleStageTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    // Set will-change for GPU promotion during gesture
    if (stageRef.current) stageRef.current.style.willChange = 'transform';
    if (trackRef.current) trackRef.current.style.willChange = 'transform';
    const t = e.touches[0];
    onGestureStart(t.clientX, t.clientY, e.target);
  }, [onGestureStart]);

  const handleStageTouchMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g.active || e.touches.length !== 1) return;
    const t = e.touches[0];

    g.lastX    = t.clientX;
    g.lastY    = t.clientY;
    g.lastTime = Date.now();

    // Only prevent-default once we've locked an axis or moved enough — avoids blocking scroll
    // on tiny taps, and allows the page underneath to handle ambiguous starts.
    const dx = Math.abs(t.clientX - g.startX);
    const dy = Math.abs(t.clientY - g.startY);
    if ((g.axis || dx > 4 || dy > 4) && e.cancelable) {
      e.preventDefault();
    }

    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(applyGestureTransform);
    }
  }, [applyGestureTransform]);

  const handleStageTouchEnd = useCallback(() => {
    onGestureEnd();
  }, [onGestureEnd]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // Attach native (non-passive) touch events to the stage DOM node
  useEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return;
    stage.addEventListener('touchstart',  handleStageTouchStart, { passive: true });
    stage.addEventListener('touchmove',   handleStageTouchMove,  { passive: false });
    stage.addEventListener('touchend',    handleStageTouchEnd,   { passive: true });
    stage.addEventListener('touchcancel', handleStageTouchEnd,   { passive: true });
    return () => {
      stage.removeEventListener('touchstart',  handleStageTouchStart);
      stage.removeEventListener('touchmove',   handleStageTouchMove);
      stage.removeEventListener('touchend',    handleStageTouchEnd);
      stage.removeEventListener('touchcancel', handleStageTouchEnd);
    };
  }, [open, handleStageTouchStart, handleStageTouchMove, handleStageTouchEnd]);

  const toggleControls = useCallback(() => {
    setControlsVisible(v => !v);
    setShowMoreMenu(false);
  }, []);

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) handleClose();
  };

  // ── Download ────────────────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (downloadState) return;
    const url = currentItem?.url;
    if (!url) return;
    const isVideoItem = currentItem.type === 'video' || currentItem.isVideo;

    setDownloadState('preparing');
    const controller = new AbortController();
    downloadAbortRef.current = controller;

    try {
      const cacheBustUrl = url + (url.includes('?') ? '&' : '?') + `download=${Date.now()}`;
      const response = await fetch(cacheBustUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setDownloadState('downloading');

      let blob = await response.blob();
      let filename = url.split('/').pop()?.split('?')[0] || 'media';
      let extension = filename.split('.').pop() || '';

      if (!isVideoItem && (blob.type === 'image/webp' || extension.toLowerCase() === 'webp')) {
        setDownloadState('converting');
        const imageBitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width  = imageBitmap.width;
        canvas.height = imageBitmap.height;
        canvas.getContext('2d').drawImage(imageBitmap, 0, 0);
        blob = await new Promise((res, rej) =>
          canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png')
        );
        filename = filename.replace(/\.webp$/i, '.png');
        if (!filename.toLowerCase().endsWith('.png')) filename += '.png';
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);

      setDownloadState('completed');
      setTimeout(() => setDownloadState(null), 1500);
    } catch (err) {
      setDownloadState(err.name === 'AbortError' ? 'cancelled' : 'failed');
      setTimeout(() => setDownloadState(null), 2000);
    } finally {
      downloadAbortRef.current = null;
    }
  };

  const handleCancelDownload = () => {
    downloadAbortRef.current?.abort();
  };

  const handleShare = async () => {
    const url = currentItem?.url;
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ url });
      else { await navigator.clipboard?.writeText(url); showToast('Link copied'); }
    } catch (_) {}
  };

  if (!open) return null;

  const hasMany = items.length > 1;

  return createPortal(
    <div
      ref={overlayRef}
      data-media-viewer="true"
      data-theme="dark"
      className={`${styles.overlay} ${visible ? styles.visible : ''}`}
      onClick={handleOverlayClick}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
    >
      {/* ── Counter badge ── */}
      {hasMany && (
        <div className={`${styles.counterBadge} ${controlsVisible ? styles.controlsVisible : ''}`}>
          {index + 1} / {items.length}
        </div>
      )}

      {/* ── Top bar ── */}
      <div className={`${styles.topBar} ${controlsVisible ? styles.controlsVisible : ''}`}>
        <div className={styles.topBarLeft}>
          <button className={styles.iconBtn} onClick={handleClose} aria-label="Close">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.topBarRight}>
          {/* Forward — only for DM attachments */}
          {meta?.source !== 'Post' && (
            <button className={styles.iconBtn} onClick={() => setShowForwardModal(true)} aria-label="Forward">
              <Forward size={18} strokeWidth={1.75} />
            </button>
          )}

          {/* More menu */}
          <div className={styles.moreMenuWrap}>
            <button
              className={styles.iconBtn}
              onClick={(e) => { e.stopPropagation(); setShowMoreMenu(!showMoreMenu); }}
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
            >
              <MoreVertical size={18} strokeWidth={1.75} />
            </button>
            <div
              className={`${styles.moreMenu} ${showMoreMenu ? styles.open : ''}`}
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className={styles.moreMenuItem}
                role="menuitem"
                onClick={() => { handleDownload(); setShowMoreMenu(false); }}
              >
                <Download size={15} strokeWidth={1.75} />
                Download
              </button>

              {meta?.source !== 'Post' && (
                <button
                  className={styles.moreMenuItem}
                  role="menuitem"
                  onClick={() => { handleShare(); setShowMoreMenu(false); }}
                >
                  <Share size={15} strokeWidth={1.75} />
                  Share
                </button>
              )}

              <button
                className={styles.moreMenuItem}
                role="menuitem"
                onClick={() => { setShowMoreMenu(false); if (!hasReported) setShowReportModal(true); }}
                disabled={hasReported}
              >
                <Flag size={15} strokeWidth={1.75} />
                {hasReported ? 'Already Reported' : 'Report'}
              </button>

              {meta?.isOwner && (
                <button
                  className={`${styles.moreMenuItem} ${styles.danger}`}
                  role="menuitem"
                  onClick={() => { showToast('Deleted'); handleClose(); setShowMoreMenu(false); }}
                >
                  <Trash2 size={15} strokeWidth={1.75} />
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Media stage ──
          Touch events are attached natively (non-passive) for mobile swipe & dismiss gestures.
          Desktop users navigate with arrow buttons & keyboard. ── */}
      <div
        className={styles.stage}
        ref={stageRef}
        onClick={() => setShowMoreMenu(false)}
      >
        <div
          className={styles.stageTrack}
          ref={trackRef}
          style={{ transform: `translate3d(-${index * 100}%, 0, 0)` }}
        >
          {items.map((item, i) => {
            const shouldRender = Math.abs(i - index) <= 1;
            const isCurrent = i === index;
            const isItemVideo = isVideo(item);

            return (
              <div key={item?.url || i} className={styles.slide} data-slide-index={i}>
                {shouldRender && item?.url && (
                  isItemVideo ? (
                    <VideoViewer
                      key={item.url}
                      src={item.url}
                      mediaRef={isCurrent ? mediaElRef : null}
                      onControlsChange={isCurrent ? setControlsVisible : undefined}
                      onStageClick={() => setShowMoreMenu(false)}
                      isCurrent={isCurrent}
                    />
                  ) : (
                    <ImageViewer
                      key={item.url}
                      src={item.url}
                      mediaRef={isCurrent ? mediaElRef : null}
                      onToggleControls={toggleControls}
                      isCurrent={isCurrent}
                    />
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Nav buttons — outside stage so they don't translate with it ── */}
      {hasMany && (
        <>
          <button
            type="button"
            className={`${styles.navBtn} ${styles.navPrev} ${controlsVisible ? styles.controlsVisible : ''}`}
            onClick={(e) => { e.stopPropagation(); navigate(-1); }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={index === 0}
            aria-label="Previous"
          >
            <ChevronLeft size={20} strokeWidth={2.25} />
          </button>
          <button
            type="button"
            className={`${styles.navBtn} ${styles.navNext} ${controlsVisible ? styles.controlsVisible : ''}`}
            onClick={(e) => { e.stopPropagation(); navigate(1); }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={index === items.length - 1}
            aria-label="Next"
          >
            <ChevronRight size={20} strokeWidth={2.25} />
          </button>
        </>
      )}



      {/* ── Modals ── */}
      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        targetType={meta?.postId ? 'POST' : (meta?.author?.id ? 'USER' : 'POST')}
        targetId={meta?.postId || meta?.author?.id || currentItem?.url || 'media'}
        targetName={meta?.author?.name || meta?.author?.username}
        targetAvatar={meta?.author?.avatar}
        targetPreview={currentItem?.caption || meta?.post?.text?.slice(0, 80)}
        reportedFrom="media-viewer"
        onSubmitted={() => setHasReported(true)}
      />

      {showForwardModal && (
        <LazyForwardModal
          isOpen={showForwardModal}
          currentItem={currentItem}
          onClose={() => setShowForwardModal(false)}
        />
      )}

      {downloadState && (
        <div className={styles.downloadModalOverlay}>
          <div className={styles.downloadModal}>
            {['preparing', 'downloading', 'converting'].includes(downloadState) ? (
              <div className={styles.downloadSpinner} />
            ) : downloadState === 'completed' ? (
              <div className={styles.downloadIconSuccess}>✓</div>
            ) : (
              <div className={styles.downloadIconError}>✕</div>
            )}
            <div className={styles.downloadText}>
              {downloadState === 'preparing'   && 'Preparing download…'}
              {downloadState === 'downloading' && 'Downloading media…'}
              {downloadState === 'converting'  && 'Converting to PNG…'}
              {downloadState === 'completed'   && 'Download completed'}
              {downloadState === 'failed'      && 'Download failed'}
              {downloadState === 'cancelled'   && 'Download cancelled'}
            </div>
            {['preparing', 'downloading', 'converting'].includes(downloadState) && (
              <button className={styles.downloadCancelBtn} onClick={handleCancelDownload}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

/**
 * Lazy component that only subscribes to conversations and message action hooks
 * when the forward modal is actually opened.
 */
function LazyForwardModal({ isOpen, currentItem, onClose }) {
  // The picker's list, not the inbox's. Forward is a recipient choice, so it
  // must exclude threads that cannot be sent into; useConversations would have
  // offered every thread the user has.
  const { conversations } = useRecipientConversations(isOpen);
  const { sendDirectMessage } = useMessageActions();

  if (!isOpen) return null;

  return (
    <ForwardMessageModal
      isOpen={isOpen}
      msg={{ mediaUrl: currentItem?.url, mediaType: currentItem?.type || 'image' }}
      conversations={conversations || []}
      onClose={onClose}
      onConfirmForward={async (targetIds) => {
        try {
          for (const id of targetIds) {
            await sendDirectMessage(id, {
              text: '',
              mediaUrl: currentItem?.url,
              mediaType: currentItem?.type || 'image',
            });
          }
        } catch (_) {}
        finally {
          onClose();
        }
      }}
    />
  );
}
