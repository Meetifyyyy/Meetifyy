import { Suspense, lazy, useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useMediaViewer } from '@shared/context/MediaViewerContext';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import ImageViewer from './ImageViewer';
import VideoViewer from './VideoViewer';
import { mediaCache } from '@shared/utils/MediaCacheManager';
import { feedVideoRegistry } from '@shared/utils/feedVideoRegistry';
import { PLAYBACK_PRIORITY } from '@shared/utils/playbackPriority';
import { hasReportedTarget, markTargetReported, reportKey } from '@shared/utils/reportedTargets';
import { forwardableMediaUrl } from './forwardSource';
import { useViewerFocus } from './useViewerFocus';
import { motionTransition, prefersReducedMotion } from './viewerMotion';
import { createGestureSpring, releaseVelocity, rubberBand } from '@shared/lib/gestureSpring';
import styles from './MediaViewer.module.css';
import ReportModal from '@shared/components/modals/ReportModal/LazyReportModal';
import { useMessageActions } from '@shared/hooks/useMessageActions';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Forward,
  MoreVertical,
  Download,
  Flag,
} from '@shared/components/icons';
import Menu, { MenuItem, useMenu } from '@shared/components/ui/Menu';

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
/** Corner radius (on-screen px) the media reaches while dragged to dismiss. */
const DISMISS_CORNER_RADIUS = 24;

/**
 * A `clip-path` that rounds the corners of the PICTURE inside a media element.
 *
 * `border-radius` would round the element's box, and a video's box is the
 * whole stage (object-fit: contain), so its letterbox corners — invisible —
 * would be the rounded ones. The inset is the letterbox, computed from the
 * media's own size, so the visible picture is what gets the corners. `radius`
 * is in the element's own (unscaled) px.
 */
function pictureClip(el, radius, knownBox) {
  const r = Math.max(0, radius).toFixed(1);
  // A drag passes the box it measured once at its start: measuring per move
  // read layout right after the transform write, every frame.
  const box = knownBox !== undefined ? knownBox : pictureBox(el);
  if (!box) return `inset(0px round ${r}px)`;
  const f = (n) => Math.max(0, n).toFixed(1);
  return `inset(${f(box.top)}px ${f(box.right)}px ${f(box.bottom)}px ${f(box.left)}px round ${r}px)`;
}

/** A media element's own letterbox (object-fit: contain), in its own px. */
function ownLetterbox(media) {
  const w = media.clientWidth;
  const h = media.clientHeight;
  const iw = media.naturalWidth || media.videoWidth || 0;
  const ih = media.naturalHeight || media.videoHeight || 0;
  if (!(w > 0 && h > 0 && iw > 0 && ih > 0)) return { x: 0, y: 0, w, h };
  const fit = Math.min(w / iw, h / ih);
  return { x: (w - iw * fit) / 2, y: (h - ih * fit) / 2, w: iw * fit, h: ih * fit };
}

/**
 * Where the visible picture sits inside `el`, as insets from each of its
 * edges in `el`'s own (untransformed) px — or null when there is no picture.
 *
 * `el` is what the dismiss drag moves. For a video it is the <video> (whose
 * box is the whole stage, letterboxed); for a photo it is the stage-sized
 * wrapper around the <img>, so the picture has to be found inside it. Rounding
 * the wrapper's own corners rounded empty space and nothing visible changed.
 */
function pictureBox(el) {
  const isMedia = el.tagName === 'IMG' || el.tagName === 'VIDEO';
  const media = isMedia
    ? el
    : (el.querySelector('video')
      || [...el.querySelectorAll('img')].reverse().find((img) => img.naturalWidth > 0));
  if (!media) return null;
  const lb = ownLetterbox(media);
  if (isMedia) {
    return { left: lb.x, top: lb.y, right: el.clientWidth - lb.x - lb.w, bottom: el.clientHeight - lb.y - lb.h };
  }
  // Both rects carry the drag's transform; dividing by it gives el's own px.
  const er = el.getBoundingClientRect();
  const mr = media.getBoundingClientRect();
  const scale = el.offsetWidth > 0 ? er.width / el.offsetWidth : 1;
  const inner = media.offsetWidth > 0 ? (mr.width / scale) / media.offsetWidth : 1;
  const left = (mr.left - er.left) / scale + lb.x * inner;
  const top = (mr.top - er.top) / scale + lb.y * inner;
  return {
    left,
    top,
    right: el.offsetWidth - left - lb.w * inner,
    bottom: el.offsetHeight - top - lb.h * inner,
  };
}

/** Radius for a drag `progress` (0-1): eased in, so the first pixels of a drag do not snap. */
function dismissRadius(progress, scale) {
  const t = Math.min(1, progress / 0.25);
  const eased = t * t * (3 - 2 * t);
  return (DISMISS_CORNER_RADIUS * eased) / (scale || 1);
}

/** Vertical: fraction of viewport height that triggers dismiss. */
const DISMISS_DISTANCE_THRESHOLD = 0.30;
/** Vertical: release speed (px/s) that triggers dismiss. */
const DISMISS_VELOCITY_THRESHOLD = 700;
/** Vertical: minimum absolute distance (px) before velocity alone can dismiss. */
const DISMISS_MIN_FOR_VELOCITY = 40;
/** Vertical: the dismiss fly-out leaves at least this fast (px/s). */
const DISMISS_MIN_EXIT_SPEED = 1600;
/** Keyboard: how far one arrow press pans a zoomed image (px). */
const KEY_PAN_STEP = 80;

/**
 * One mounted instance per OPEN of the viewer.
 *
 * The host keeps this component mounted for the whole session (so the chunk and
 * the close animation survive), which meant every piece of local state - a
 * Forward sheet, a report flow, a download in progress - outlived the item it
 * belonged to and reappeared over the next one. `openViewer` bumps `sessionId`,
 * and keying the inner component on it gives each open a clean slate; the
 * unmount also aborts whatever the previous open still had running.
 */
export default function MediaViewer() {
  const { state } = useMediaViewer();
  return <MediaViewerSession key={state.sessionId ?? 0} />;
}

/** What the report flow targets: the item's own, else the opener's default. */
function reportTargetFor(item, meta) {
  const candidate = item?.report ?? meta?.report;
  if (!candidate || typeof candidate !== 'object') return null;
  const { targetType, targetId } = candidate;
  if (typeof targetType !== 'string' || targetType === '') return null;
  if (typeof targetId !== 'string' || targetId === '') return null;
  return candidate;
}

function MediaViewerSession() {
  const { state, closeViewer, navigate } = useMediaViewer();
  const { open, items, index, meta } = state;

  const overlayRef  = useRef(null);
  // The black behind the media, a layer of its own so a drag fades it by
  // opacity on the compositor instead of repainting the whole overlay's
  // background colour every frame.
  const backdropRef = useRef(null);
  const stageRef    = useRef(null);
  const trackRef    = useRef(null);
  /** Ref forwarded to the media element (img or video) for vertical drag. */
  const mediaElRef  = useRef(null);

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef(null);
  /** Zoom controls of the CURRENT image slide (null on a video or while loading). */
  const zoomApiRef = useRef(null);
  // The snap-back clears its inline styles after the transition. Tracked so a
  // newer gesture, a close or an unmount can cancel it instead of letting it
  // erase what they wrote (see resetGestureTransforms).
  const snapbackTimerRef = useRef(null);

  const [visible, setVisible]               = useState(false);
  // The current video is fullscreen: the viewer's own chrome steps aside.
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const moreMenu = useMenu();
  const closeMoreMenu = moreMenu.close;
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  // Bumped when something is marked reported, so the menu re-reads the shared set.
  const [, setReportedTick]                 = useState(0);
  const [downloadState, setDownloadState]   = useState(null);
  /** The download in flight (its AbortController), or null. Doubles as its identity. */
  const downloadAbortRef = useRef(null);
  /** Pending "clear the status" timer, so a close or a new download can cancel it. */
  const downloadStatusTimerRef = useRef(null);

  const cancelSnapbackCleanup = useCallback(() => {
    clearTimeout(snapbackTimerRef.current);
    snapbackTimerRef.current = null;
  }, []);

  /**
   * Stop the download in flight and forget it. Clearing the ref is what makes the
   * abandoned run harmless: every state write it still attempts is conditional on
   * being the CURRENT run (see handleDownload).
   */
  const abortDownload = useCallback(() => {
    clearTimeout(downloadStatusTimerRef.current);
    downloadStatusTimerRef.current = null;
    const controller = downloadAbortRef.current;
    downloadAbortRef.current = null;
    controller?.abort();
    setDownloadState(null);
  }, []);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // The dismiss fly-out has just been written; a pending snap-back cleanup
    // would clear it mid-flight.
    cancelSnapbackCleanup();
    setClosing(true);
    setVisible(false);
    closeMoreMenu();
    abortDownload();
    // Stop the viewer's audio immediately, rather than waiting for unmount.
    overlayRef.current?.querySelectorAll('video').forEach(video => video.pause());
    controlsHiddenByGesture.current = false;
    setGestureHidesControls(false);
    // Pause all feed videos (below MediaViewer priority 10) on close
    feedVideoRegistry.pauseAll(PLAYBACK_PRIORITY.VIEWER);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      closeViewer();
    }, prefersReducedMotion() ? 0 : 280);
  }, [closeViewer, closeMoreMenu, cancelSnapbackCleanup, abortDownload]);

  useEffect(() => () => {
    clearTimeout(closeTimerRef.current);
    clearTimeout(snapbackTimerRef.current);
    clearTimeout(downloadStatusTimerRef.current);
    downloadAbortRef.current?.abort();
    downloadAbortRef.current = null;
  }, []);

  // Whatever is playing behind the viewer - a feed video, a voice note - stops
  // when it opens. Its own registry would only refuse NEW lower-priority plays;
  // something already running has to be told.
  useEffect(() => {
    if (open) feedVideoRegistry.pauseAll(PLAYBACK_PRIORITY.VIEWER);
  }, [open]);

  // The viewer is portalled outside #root, so the bars' DOM observers do not
  // see it start closing; tell them, once the attribute above is in the DOM.
  useEffect(() => {
    if (closing) window.dispatchEvent(new Event('meetifyy:system-bars-resample'));
  }, [closing]);

  useOverlayBack(open, handleClose);
  useScrollLock(open);

  const currentItem = items[index] || null;
  const isVid       = isVideo(currentItem);

  // Keep index in a ref so gesture callbacks always see the latest value
  // without needing to be recreated on every index change.
  const indexRef      = useRef(index);
  const itemsLenRef   = useRef(items.length);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { itemsLenRef.current = items.length; }, [items.length]);

  const controlsHiddenByGesture = useRef(false);
  // Mirrors the ref for rendering: a video's own bottom bar hides with the header.
  const [gestureHidesControls, setGestureHidesControls] = useState(false);

  // ── Open / close animation ──────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    if (open) {
      closingRef.current = false;
      barsFollowPageRef.current = false;
      setClosing(false);
      setControlsVisible(true);
      trackSpringRef.current?.stop();
      dismissSpringRef.current?.stop();
      if (trackRef.current) {
        trackRef.current.style.transition = 'none';
        trackRef.current.style.transform = `translate3d(-${indexRef.current * 100}%, 0, 0)`;
      }
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    } else {
      setVisible(false);
    }
  }, [open, items]);

  // Sync track position smoothly when index changes
  useEffect(() => {
    if (!open) return;
    // A swipe's own spring is already carrying the strip there.
    if (trackSpringRef.current?.isMoving()) return;
    if (trackRef.current && !gestureRef.current.active) {
      trackRef.current.style.transition = motionTransition('transform', 0.32);
      trackRef.current.style.transform  = `translate3d(-${index * 100}%, 0, 0)`;
    }
  }, [index, open]);


  // The outside-click listener is gone — `Menu` owns its own dismissal.

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      // Focus can fall to <body> while the viewer is open (the control that held it
      // was hidden and made inert), and keys must keep working there.
      const inViewer = e.target.closest?.('[role="dialog"]') === overlayRef.current;
      const orphaned = e.target === document.body || e.target === document.documentElement;
      if (e.defaultPrevented || !(inViewer || orphaned)) return;
      if (e.key === 'Escape') { handleClose(); return; }
      if (isVid) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Zoom keys, and arrows that pan a ZOOMED image. At 1x - or when the image
      // is already against the edge in the arrow's direction - the left and
      // right arrows keep paging the gallery, so zoom never traps the keyboard.
      const zoom = zoomApiRef.current;
      switch (e.key) {
        case '+':
        case '=':
          if (zoom) { e.preventDefault(); zoom.zoomIn(); }
          return;
        case '-':
        case '_':
          if (zoom) { e.preventDefault(); zoom.zoomOut(); }
          return;
        case '0':
          if (zoom) { e.preventDefault(); zoom.reset(); }
          return;
        case 'ArrowLeft':
          if (zoom?.isZoomed() && zoom.panBy(KEY_PAN_STEP, 0)) { e.preventDefault(); return; }
          navigate(-1);
          return;
        case 'ArrowRight':
          if (zoom?.isZoomed() && zoom.panBy(-KEY_PAN_STEP, 0)) { e.preventDefault(); return; }
          navigate(1);
          return;
        case 'ArrowUp':
          if (zoom?.isZoomed() && zoom.panBy(0, KEY_PAN_STEP)) e.preventDefault();
          return;
        case 'ArrowDown':
          if (zoom?.isZoomed() && zoom.panBy(0, -KEY_PAN_STEP)) e.preventDefault();
          return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, navigate, isVid, handleClose]);

  useViewerFocus(open, overlayRef);

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

  /**
   * While the backdrop is fading under a vertical drag it is translucent, and
   * the system bars' sampler looks through it to the document's own gradient
   * (the blue behind the app), painting the status bar with that for as long
   * as the finger is down. Asking the sampler to ignore the viewer for the
   * drag makes the bars read the page actually showing through - white in the
   * light theme. Snapping back hands the bars to the viewer again. A no-op on
   * the website, where nothing listens.
   */
  const barsFollowPageRef = useRef(false);
  const setBarsFollowPage = useCallback((follow) => {
    if (barsFollowPageRef.current === follow) return;
    barsFollowPageRef.current = follow;
    const el = overlayRef.current;
    if (el) {
      if (follow) el.setAttribute('data-bars-ignore', '');
      else if (!closingRef.current) el.removeAttribute('data-bars-ignore');
    }
    window.dispatchEvent(new Event('meetifyy:system-bars-resample'));
  }, []);

  // ── Release springs ─────────────────────────────────────────────────────────
  // While a finger is down everything follows it 1:1. When it lifts, a spring
  // seeded with the finger's speed finishes the motion: the strip of slides
  // (paging) and the dragged picture (snap-back or dismiss). Either can be
  // caught by the next touch and continues from where it visibly is.

  /** The picture's box for the clip, measured once per vertical drag. */
  const clipBoxRef = useRef(undefined);

  /**
   * Everything a vertical drag moves, derived from ONE value (the picture's
   * offset): its position, the shrink, the rounded corners and the backdrop's
   * fade. Linked this way they can never drift apart, mid-drag, mid-spring or
   * when the user reverses.
   */
  const paintDismiss = useCallback((y) => {
    const vh = window.visualViewport?.height || window.innerHeight;
    const progress = Math.min(Math.abs(y) / (vh * 0.55), 1);
    // Shrinks a little as it is pulled away, so the drag reads as the photo
    // being lifted off rather than the page sliding.
    const scale = 1 - progress * 0.12;
    const media = mediaElRef.current;
    if (media) {
      if (clipBoxRef.current === undefined) clipBoxRef.current = pictureBox(media);
      media.style.transition = 'none';
      media.style.willChange = 'transform';
      media.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
      // The corners round as it is lifted away (see pictureClip).
      media.style.clipPath = pictureClip(media, dismissRadius(progress, scale), clipBoxRef.current);
    }
    if (backdropRef.current) {
      backdropRef.current.style.transition = 'none';
      backdropRef.current.style.opacity = String(1 - progress * 0.85);
    }
  }, []);

  const dismissSpringRef = useRef(null);
  const getDismissSpring = useCallback(() => {
    if (!dismissSpringRef.current) {
      dismissSpringRef.current = createGestureSpring((y) => paintDismiss(y), { stiffness: 420, dampingRatio: 0.9 });
    }
    return dismissSpringRef.current;
  }, [paintDismiss]);

  const trackSpringRef = useRef(null);
  const getTrackSpring = useCallback(() => {
    if (!trackSpringRef.current) {
      trackSpringRef.current = createGestureSpring((x) => {
        const track = trackRef.current;
        if (!track) return;
        track.style.transition = 'none';
        track.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
      }, { stiffness: 340, dampingRatio: 1 });
    }
    return trackSpringRef.current;
  }, []);

  /** Spring the strip to slide `to`, starting at `velocity` px/s. */
  const springTrackTo = useCallback((to, velocity) => {
    const track = trackRef.current;
    if (!track) return;
    const vw = stageRef.current?.clientWidth || window.visualViewport?.width || window.innerWidth;
    const spring = getTrackSpring();
    spring.to(-to * vw, {
      velocity,
      instant: prefersReducedMotion(),
      // At rest it goes back to the % form the stylesheet and resizes expect.
      done: () => {
        track.style.transform = `translate3d(-${to * 100}%, 0, 0)`;
      },
    });
  }, [getTrackSpring]);

  useEffect(() => () => {
    trackSpringRef.current?.stop();
    dismissSpringRef.current?.stop();
  }, []);

  /** Clear the vertical drag's inline styles so the stylesheet takes over. */
  const clearDismissStyles = useCallback(() => {
    clipBoxRef.current = undefined;
    const media = mediaElRef.current;
    const backdrop = backdropRef.current;
    const overlay = overlayRef.current;
    if (media) {
      media.style.transition = '';
      media.style.transform = '';
      media.style.clipPath = '';
      media.style.willChange = '';
    }
    if (backdrop) {
      backdrop.style.transition = '';
      backdrop.style.opacity = '';
    }
    // The backdrop is fully black again: give the colour back to the overlay,
    // where the system bars read it.
    if (overlay) {
      overlay.style.transition = '';
      overlay.style.background = '';
    }
  }, []);

  /**
   * Put the dragged picture and the backdrop back after a vertical drag: a
   * spring from where it is, at the speed it was released (`velocity`, px/s),
   * with a slight settle because the drag applied force. Its cleanup runs
   * only when the spring comes to rest, and a newer gesture or a close stops
   * the spring first, so it can never erase what they wrote.
   */
  const resetGestureTransforms = useCallback((animated = true, velocity = 0) => {
    cancelSnapbackCleanup();
    setBarsFollowPage(false);
    const spring = getDismissSpring();
    spring.to(0, {
      velocity,
      instant: !animated || prefersReducedMotion(),
      done: clearDismissStyles,
    });
  }, [cancelSnapbackCleanup, setBarsFollowPage, getDismissSpring, clearDismissStyles]);

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
    // No paging or swipe-to-dismiss under a fullscreen video: leaving
    // fullscreen is the player's button (or Back), not a stray drag.
    if (target.closest('[data-fullscreen]')) return;
    // Skip if on a video control element — video manages its own touch
    if (isVid && isVideoControl(target)) return;

    // A snap-back from the previous drag may still be settling. This gesture is
    // about to write the same elements, so that cleanup must not run over it.
    cancelSnapbackCleanup();

    // Caught mid-flight: the next drag continues from where things visibly
    // are, on the axis they were already moving along.
    const track = trackSpringRef.current;
    const dismiss = dismissSpringRef.current;
    let axis = null;
    let baseX = null;
    let baseY = 0;
    if (track?.isMoving()) {
      baseX = track.value();
      track.stop();
      axis = 'h';
    } else if (dismiss?.isMoving()) {
      baseY = dismiss.value();
      dismiss.stop();
      axis = 'v';
    }

    gestureRef.current = {
      startX: clientX,
      startY: clientY,
      lastX: clientX,
      lastY: clientY,
      startTime: Date.now(),
      lastTime: Date.now(),
      samples: [],
      baseX,
      baseY,
      axis,
      active: true,
    };
  }, [isVid, cancelSnapbackCleanup]);

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
      const vw = stageRef.current?.clientWidth || window.visualViewport?.width || window.innerWidth;
      const rest = -idx * vw;
      // From where the strip was picked up (mid-spring) or its resting place.
      let offset = (g.baseX ?? rest) - rest + dx;

      // Past the first or last slide it stretches instead of stopping dead.
      if (atLeft && offset > 0) offset = rubberBand(offset, vw * BOUNDARY_RESISTANCE * 0.5);
      else if (atRight && offset < 0) offset = -rubberBand(-offset, vw * BOUNDARY_RESISTANCE * 0.5);

      getTrackSpring().set(rest + offset);
    } else if (g.axis === 'v') {
      // ── Vertical: move only the media element, 1:1 with the finger ───────
      const y = g.baseY + dy;
      getDismissSpring().set(y);
      const vh = window.visualViewport?.height || window.innerHeight;
      const bgOpacity = 1 - Math.min(Math.abs(y) / (vh * 0.55), 1) * 0.85;
      // Hand the black over to the backdrop layer: one repaint at the start of
      // the drag, then only opacity changes.
      if (overlayRef.current && overlayRef.current.style.background !== 'transparent') {
        overlayRef.current.style.transition = 'none';
        overlayRef.current.style.background = 'transparent';
      }
      if (bgOpacity < 1) setBarsFollowPage(true);

      // Fade controls as the user drags — one-shot ref flag (no React state in hot path)
      if (!controlsHiddenByGesture.current && Math.abs(dy) > 20) {
        controlsHiddenByGesture.current = true;
        setControlsVisible(false);
        setGestureHidesControls(true);
      }
    }
  }, [setBarsFollowPage, getTrackSpring, getDismissSpring]);

  /**
   * Abandon the gesture in progress WITHOUT deciding anything.
   *
   * A gesture only commits (turns a swipe into a page change, a drag into a
   * dismiss) when the user lifts a single finger on their own terms. It is
   * cancelled instead when the OS takes the touch away (`touchcancel`), when a
   * second finger arrives (that finger is the start of a pinch, which belongs to
   * the image), and when a finger lifts while another is still down. Evaluating
   * the thresholds in those cases turned a cancelled or reassigned gesture into a
   * navigation or a close.
   *
   * Everything the gesture moved goes back where it was.
   */
  const cancelGesture = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    const g = gestureRef.current;
    if (!g.active) return;
    g.active = false;
    const { axis } = g;
    g.axis = null;

    if (stageRef.current) stageRef.current.style.willChange = '';
    if (trackRef.current) trackRef.current.style.willChange = '';

    if (axis === 'h') {
      springTrackTo(indexRef.current, 0);
    } else if (axis === 'v') {
      resetGestureTransforms(true);
    }
    if (controlsHiddenByGesture.current) {
      controlsHiddenByGesture.current = false;
      setControlsVisible(true);
      setGestureHidesControls(false);
    }
  }, [resetGestureTransforms, springTrackTo]);

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

    // Release speed (px/s) from the last ~100 ms of the drag: a flick is
    // judged by how the finger left, not by the gesture's average.
    const velX = releaseVelocity(g.samples.map((p) => ({ x: p.x, t: p.t })));
    const velY = releaseVelocity(g.samples.map((p) => ({ x: p.y, t: p.t })));
    const vw0  = stageRef.current?.clientWidth || window.visualViewport?.width || window.innerWidth;
    // Distance travelled, counted from where a caught spring was picked up.
    const dx  = g.lastX - g.startX + (g.baseX != null ? g.baseX + indexRef.current * vw0 : 0);
    const dy  = g.lastY - g.startY + g.baseY;
    const vx  = Math.abs(velX) / 1000; // px/ms, as the thresholds are written
    const idx = indexRef.current;
    const len = itemsLenRef.current;

    if (g.axis === 'h') {
      const vw             = stageRef.current?.clientWidth || window.visualViewport?.width || window.innerWidth;
      const distThreshold  = vw * SWIPE_DISTANCE_THRESHOLD;
      const swipeLeft      = dx < 0;
      const swipeRight     = dx > 0;
      const pastDist       = Math.abs(dx) > distThreshold;
      const pastVelocity   = vx > SWIPE_VELOCITY_THRESHOLD && Math.abs(dx) > 30;

      let to = idx;
      if ((pastDist || pastVelocity) && swipeLeft && idx < len - 1) to = idx + 1;
      else if ((pastDist || pastVelocity) && swipeRight && idx > 0) to = idx - 1;
      // The strip leaves at the finger's speed and settles on the slide.
      springTrackTo(to, velX);
      if (to !== idx) navigate(to - idx);
    } else if (g.axis === 'v') {
      const vh            = window.visualViewport?.height || window.innerHeight;
      const distThreshold = vh * DISMISS_DISTANCE_THRESHOLD;
      const absDy         = Math.abs(dy);
      const pastDist      = absDy > distThreshold;
      const pastVelocity  = Math.abs(velY) > DISMISS_VELOCITY_THRESHOLD
        && Math.sign(velY) === Math.sign(dy) && absDy > DISMISS_MIN_FOR_VELOCITY;

      if (pastDist || pastVelocity) {
        // Dismiss: the picture keeps going the way it was thrown, at least
        // briskly, with the backdrop fading from the same value.
        const sign = dy > 0 ? 1 : -1;
        const exit = sign * Math.max(Math.abs(velY), DISMISS_MIN_EXIT_SPEED);
        getDismissSpring().to(sign * vh * 1.1, {
          velocity: exit,
          dampingRatio: 1,
          instant: prefersReducedMotion(),
          until: (y) => Math.abs(y) >= vh,
        });
        handleClose();
      } else {
        // Snap back
        controlsHiddenByGesture.current = false;
        setControlsVisible(true);
        setGestureHidesControls(false);
        resetGestureTransforms(true, velY);
      }
    }
    // No axis: the finger never moved far enough to mean anything - a tap.
    // Nothing was transformed, so there is nothing to put back, and in
    // particular the media element's transform is not touched: for an image
    // that is its zoom.
  }, [navigate, handleClose, resetGestureTransforms, springTrackTo, getDismissSpring]);

  // ── Touch events (touch-only: desktop mouse drag navigation is disabled) ──
  const handleStageTouchStart = useCallback((e) => {
    // A second finger is a pinch: it belongs to the image, and whatever one-finger
    // gesture was under way is over.
    if (e.touches.length !== 1) {
      cancelGesture();
      return;
    }
    // Set will-change for GPU promotion during gesture
    if (stageRef.current) stageRef.current.style.willChange = 'transform';
    if (trackRef.current) trackRef.current.style.willChange = 'transform';
    const t = e.touches[0];
    onGestureStart(t.clientX, t.clientY, e.target);
  }, [onGestureStart, cancelGesture]);

  const handleStageTouchMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g.active) return;
    if (e.touches.length !== 1) {
      cancelGesture();
      return;
    }
    const t = e.touches[0];

    g.lastX    = t.clientX;
    g.lastY    = t.clientY;
    g.lastTime = Date.now();
    g.samples.push({ x: t.clientX, y: t.clientY, t: e.timeStamp });
    if (g.samples.length > 12) g.samples.shift();

    // Only prevent-default once we've locked an axis or moved enough — avoids blocking scroll
    // on tiny taps, and allows the page underneath to handle ambiguous starts.
    const dx = Math.abs(t.clientX - g.startX);
    const dy = Math.abs(t.clientY - g.startY);
    if ((g.axis || dx > 4 || dy > 4) && e.cancelable) {
      e.preventDefault();
    }

    // Painted now, not on the next frame: Android delivers one touchmove per
    // frame already, and deferring put the picture a frame behind the finger.
    applyGestureTransform();
  }, [applyGestureTransform, cancelGesture]);

  const handleStageTouchEnd = useCallback((e) => {
    // Another finger is still down: this lift ends nothing the user finished.
    if (e.touches && e.touches.length > 0) {
      cancelGesture();
      return;
    }
    onGestureEnd();
  }, [onGestureEnd, cancelGesture]);

  const handleStageTouchCancel = useCallback(() => {
    cancelGesture();
  }, [cancelGesture]);

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
    stage.addEventListener('touchstart',  handleStageTouchStart,  { passive: true });
    stage.addEventListener('touchmove',   handleStageTouchMove,   { passive: false });
    stage.addEventListener('touchend',    handleStageTouchEnd,    { passive: true });
    stage.addEventListener('touchcancel', handleStageTouchCancel, { passive: true });
    return () => {
      stage.removeEventListener('touchstart',  handleStageTouchStart);
      stage.removeEventListener('touchmove',   handleStageTouchMove);
      stage.removeEventListener('touchend',    handleStageTouchEnd);
      stage.removeEventListener('touchcancel', handleStageTouchCancel);
    };
  }, [open, handleStageTouchStart, handleStageTouchMove, handleStageTouchEnd, handleStageTouchCancel]);

  const toggleControls = useCallback(() => {
    setControlsVisible(v => !v);
    moreMenu.close();
  }, [moreMenu]);

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) handleClose();
  };

  // ── Download ────────────────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (downloadState) return;
    const url = currentItem?.url;
    if (!url) return;
    const isVideoItem = isVideo(currentItem);

    clearTimeout(downloadStatusTimerRef.current);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    const { signal } = controller;
    /*
     * Only the current run may touch the UI or save a file. Cancel, close and a
     * newer download all replace `downloadAbortRef`, so a run that is still
     * awaiting (decoding, converting) finds out at its next checkpoint and
     * stops, instead of saving a file nobody wants any more or overwriting the
     * status of whatever is on screen now. AbortController itself can only cut
     * the network phase; the checkpoints cover everything after it.
     */
    const isCurrent = () => downloadAbortRef.current === controller;
    const checkpoint = () => {
      if (signal.aborted || !isCurrent()) throw new DOMException('Cancelled', 'AbortError');
    };
    const settle = (state, ms) => {
      if (!isCurrent()) return;
      setDownloadState(state);
      downloadStatusTimerRef.current = setTimeout(() => {
        downloadStatusTimerRef.current = null;
        setDownloadState(null);
      }, ms);
    };

    let imageBitmap = null;
    setDownloadState('preparing');

    try {
      const downloadUrl = await mediaCache.getUrl(url);
      checkpoint();
      if (!downloadUrl) throw new Error('Media unavailable');
      // Signed query parameters must remain unchanged.
      const response = await fetch(downloadUrl, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setDownloadState('downloading');

      let blob = await response.blob();
      checkpoint();
      let filename = url.split('/').pop()?.split('?')[0] || 'media';
      let extension = filename.split('.').pop() || '';

      if (!isVideoItem && (blob.type === 'image/webp' || extension.toLowerCase() === 'webp')) {
        setDownloadState('converting');
        imageBitmap = await createImageBitmap(blob);
        checkpoint();
        const canvas = document.createElement('canvas');
        canvas.width  = imageBitmap.width;
        canvas.height = imageBitmap.height;
        canvas.getContext('2d').drawImage(imageBitmap, 0, 0);
        blob = await new Promise((res, rej) =>
          canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png')
        );
        checkpoint();
        filename = filename.replace(/\.webp$/i, '.png');
        if (!filename.toLowerCase().endsWith('.png')) filename += '.png';
      }

      // Last chance to stop: after this the browser owns the save.
      checkpoint();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);

      settle('completed', 1500);
    } catch (err) {
      settle(err?.name === 'AbortError' ? 'cancelled' : 'failed', 2000);
    } finally {
      // The decoded bitmap is released on every path, including a failed draw.
      imageBitmap?.close();
      if (isCurrent()) downloadAbortRef.current = null;
    }
  };

  const handleCancelDownload = () => {
    const controller = downloadAbortRef.current;
    if (!controller) return;
    // Take effect now rather than when the current phase happens to finish: the
    // run is detached first (so it can no longer save or change the status), then
    // the person is told straight away.
    downloadAbortRef.current = null;
    controller.abort();
    clearTimeout(downloadStatusTimerRef.current);
    setDownloadState('cancelled');
    downloadStatusTimerRef.current = setTimeout(() => {
      downloadStatusTimerRef.current = null;
      setDownloadState(null);
    }, 2000);
  };


  if (!open) return null;

  const hasMany = items.length > 1;

  // Report: only what the opener said. There is no guessing from the author or
  // the URL - those produced reports of the wrong kind, or of ids that do not
  // exist. No target, no Report action.
  const reportTarget = reportTargetFor(currentItem, meta);
  const currentReportKey = reportTarget ? reportKey(reportTarget) : null;
  const hasReported = currentReportKey ? hasReportedTarget(currentReportKey) : false;
  const markCurrentReported = () => {
    if (!currentReportKey) return;
    markTargetReported(currentReportKey);
    setReportedTick((n) => n + 1);
  };

  // Forward: a stored (non-expiring, non-local) reference only.
  const forwardUrl = forwardableMediaUrl(currentItem);
  const downloadBusy = ['preparing', 'downloading', 'converting'].includes(downloadState);
  const downloadMessage = {
    preparing: 'Preparing download…',
    downloading: 'Downloading media…',
    converting: 'Converting to PNG…',
    completed: 'Download completed',
    failed: 'Download failed',
    cancelled: 'Download cancelled',
  }[downloadState] || '';

  return createPortal(
    <div
      ref={overlayRef}
      data-media-viewer="true"
      data-theme="dark"
      className={`${styles.overlay} ${visible ? styles.visible : ''} ${closing ? styles.closing : ''}`}
      inert={closing ? '' : undefined}
      // Closing, the system bars read the page through the fading viewer, so
      // they take the page's colours as the fade starts rather than after it.
      data-bars-ignore={closing ? '' : undefined}
      data-video-fullscreen={videoFullscreen && isVid ? '' : undefined}
      onClick={handleOverlayClick}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
    >
      <div ref={backdropRef} className={styles.backdrop} aria-hidden="true" />
      {/* ── Counter badge ── */}
      {hasMany && (
        <div className={`${styles.counterBadge} ${controlsVisible ? styles.controlsVisible : ''}`}>
          {index + 1} / {items.length}
        </div>
      )}

      {/* ── Top bar ── */}
      <div inert={!controlsVisible ? '' : undefined} aria-hidden={!controlsVisible} className={`${styles.topBar} ${controlsVisible ? styles.controlsVisible : ''}`}>
        <div className={styles.topBarLeft}>
          <button className={styles.iconBtn} onClick={handleClose} aria-label="Close">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.topBarRight}>
          {/* Forward — only for DM attachments */}
          {meta?.source !== 'Post' && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setShowForwardModal(true)}
              disabled={!forwardUrl}
              aria-label="Forward"
              title={forwardUrl ? undefined : "This media can't be forwarded"}
            >
              <Forward size={18} strokeWidth={1.75} />
            </button>
          )}

          {/* More menu */}
          <div className={styles.moreMenuWrap}>
            <button
              {...moreMenu.triggerProps}
              className={styles.iconBtn}
              aria-label="More options"
            >
              <MoreVertical size={18} strokeWidth={1.75} />
            </button>
            <Menu {...moreMenu.menuProps} size="md" ariaLabel="Media options" className={styles.viewerMenu}>
              <MenuItem icon={Download} onSelect={handleDownload} onClose={moreMenu.close}>
                Download
              </MenuItem>

              {reportTarget && (
                <MenuItem
                  icon={Flag}
                  disabled={hasReported}
                  onSelect={() => setShowReportModal(true)}
                  onClose={moreMenu.close}
                >
                  {hasReported ? 'Already reported' : 'Report'}
                </MenuItem>
              )}

            </Menu>
          </div>
        </div>
      </div>

      {/* ── Media stage ──
          Touch events are attached natively (non-passive) for mobile swipe & dismiss gestures.
          Desktop users navigate with arrow buttons & keyboard. ── */}
      <div
        className={styles.stage}
        ref={stageRef}
        onClick={moreMenu.close}
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
              <div key={item?.slideKey ?? `${i}:${item?.url ?? ''}`} className={styles.slide} data-slide-index={i} inert={!isCurrent ? '' : undefined} aria-hidden={!isCurrent}>
                {shouldRender && item?.url && (
                  isItemVideo ? (
                    <VideoViewer
                      key={item.url}
                      src={item.url}
                      poster={item.thumb}
                      mediaRef={isCurrent ? mediaElRef : null}
                      onControlsChange={isCurrent ? setControlsVisible : undefined}
                      onFullscreenChange={isCurrent ? setVideoFullscreen : undefined}
                      onStageClick={moreMenu.close}
                      isCurrent={isCurrent && !closing}
                      gestureHidesControls={isCurrent && gestureHidesControls}
                    />
                  ) : (
                    <ImageViewer
                      key={item.url}
                      src={item.url}
                      placeholder={item.thumb}
                      label={hasMany ? `Photo ${i + 1} of ${items.length}` : 'Photo'}
                      mediaRef={isCurrent ? mediaElRef : null}
                      zoomApiRef={isCurrent ? zoomApiRef : null}
                      onToggleControls={toggleControls}
                      isCurrent={isCurrent && !closing}
                      closing={closing}
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
            inert={!controlsVisible ? '' : undefined}
            aria-hidden={!controlsVisible}
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
            inert={!controlsVisible ? '' : undefined}
            aria-hidden={!controlsVisible}
            disabled={index === items.length - 1}
            aria-label="Next"
          >
            <ChevronRight size={20} strokeWidth={2.25} />
          </button>
        </>
      )}

      {/* ── Zoom controls — a keyboard / pointer alternative to pinch and
          double-tap. Hidden on touch screens (see the stylesheet). ── */}
      {!isVid && currentItem?.url && (
        <div
          role="group"
          aria-label="Zoom"
          inert={!controlsVisible ? '' : undefined}
          aria-hidden={!controlsVisible}
          className={`${styles.zoomControls} ${controlsVisible ? styles.controlsVisible : ''}`}
        >
          <button type="button" className={styles.zoomBtn} aria-label="Zoom out" onClick={() => zoomApiRef.current?.zoomOut()}>
            &minus;
          </button>
          <button type="button" className={styles.zoomBtn} aria-label="Fit to screen" onClick={() => zoomApiRef.current?.reset()}>
            Fit
          </button>
          <button type="button" className={styles.zoomBtn} aria-label="Zoom in" onClick={() => zoomApiRef.current?.zoomIn()}>
            +
          </button>
        </div>
      )}

      {/* ── Modals ── */}
      {reportTarget && (
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          targetType={reportTarget.targetType}
          targetId={reportTarget.targetId}
          targetName={reportTarget.name ?? meta?.authorName}
          targetAvatar={reportTarget.avatar ?? meta?.authorAvatar}
          targetPreview={currentItem?.caption || (reportTarget.targetType === 'POST' ? meta?.post?.text?.slice(0, 80) : undefined)}
          reportedFrom="media-viewer"
          onSubmitted={markCurrentReported}
          onFailed={(error) => {
            // The server already holds an open report from this person for this
            // exact thing: say so from now on instead of offering it again.
            if (error?.status === 409) {
              markCurrentReported();
              setShowReportModal(false);
            }
          }}
        />
      )}

      {showForwardModal && forwardUrl && (
        <LazyForwardModal
          isOpen={showForwardModal}
          mediaUrl={forwardUrl}
          mediaType={currentItem?.type || (isVideo(currentItem) ? 'video' : 'image')}
          onClose={() => setShowForwardModal(false)}
        />
      )}

      {/* Spoken status for the download, present from the start so a screen reader
          is already listening when the text changes. */}
      <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {downloadMessage}
      </div>

      {downloadState && (
        <div className={styles.downloadModalOverlay}>
          <div className={styles.downloadModal} role="group" aria-label="Download">
            {downloadBusy ? (
              <div className={styles.downloadSpinner} aria-hidden="true" />
            ) : downloadState === 'completed' ? (
              <div className={styles.downloadIconSuccess} aria-hidden="true">✓</div>
            ) : (
              <div className={styles.downloadIconError} aria-hidden="true">✕</div>
            )}
            <div className={styles.downloadText} aria-hidden="true">
              {downloadMessage}
            </div>
            {downloadBusy && (
              <button type="button" className={styles.downloadCancelBtn} onClick={handleCancelDownload}>
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
 * Forwarding the photo or video on screen. The share sheet's picker, in its
 * forward mode, loaded only when Forward is tapped.
 *
 * `mediaUrl` is already vetted by `forwardableMediaUrl` - stored, not local, not
 * signed - so it is safe to persist into new messages.
 */
const ShareSheet = lazy(() => import('@shared/components/share/ShareSheet'));

function LazyForwardModal({ isOpen, mediaUrl, mediaType, onClose }) {
  const { sendDirectMessage } = useMessageActions();
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <ShareSheet
        isOpen
        onClose={onClose}
        forward={{
          // The ninth positional argument is the options bag; `tempId` is how a
          // client id reaches the request (see useMessageActions.sendDirectMessage).
          send: (id, clientId, sendOptions) => sendDirectMessage(
            id,
            { text: '', mediaUrl, mediaType },
            undefined, undefined, undefined, undefined, undefined, undefined,
            // The sheet passes `deferListRefresh`: it refreshes the list once.
            { tempId: clientId, ...sendOptions },
          ),
        }}
      />
    </Suspense>
  );
}
