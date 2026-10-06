import { useState, useRef, useEffect, useCallback } from 'react';
import VideoViewer from './VideoViewer';
import { useSignedMediaSrc } from '@shared/hooks/useSignedMediaSrc';
import styles from './MediaViewer.module.css';
import { prefersReducedMotion } from './viewerMotion';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 280;
/** A touch that moves farther than this (px) is a drag, not a tap. */
const TAP_SLOP_PX = 12;
/** A touch held longer than this (ms) is a press, not a tap. */
const TAP_MAX_MS = 350;
/** Two taps farther apart than this (px) are two separate taps. */
const DOUBLE_TAP_DISTANCE_PX = 40;
/** Keyboard zoom multiplier per key press. */
const KEY_ZOOM_STEP = 1.5;
const DOUBLE_TAP_ZOOM = 2;
const MOMENTUM_FRICTION = 0.88;   // per-frame multiplier (lower = stops faster)
const MOMENTUM_MIN_SPEED = 0.3;   // px/frame below which we stop
const MOMENTUM_HISTORY_MS = 100;  // only use drag samples from last N ms for velocity
const ANIM_DURATION_MS = 220;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Clamp a number between [min, max]. */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Given the current transform state and the natural/rendered image size +
 * viewport size, return a clamped { tx, ty } so the image never reveals
 * empty background.
 *
 * The image is rendered with CSS max-width/max-height: 100% so its natural
 * display size (at scale=1) is stored in imgSize. We scale that by `scale`
 * to get the actual on-screen dimensions at the current zoom level.
 */
function clampTranslation(tx, ty, scale, imgSize, vpSize) {
  if (!imgSize || !vpSize || imgSize.w === 0 || vpSize.w === 0) {
    return { tx, ty };
  }

  const scaledW = imgSize.w * scale;
  const scaledH = imgSize.h * scale;

  // If the scaled image is narrower than the viewport, center horizontally.
  const maxTx = scaledW > vpSize.w ? (scaledW - vpSize.w) / 2 : 0;
  // If the scaled image is shorter than the viewport, center vertically.
  const maxTy = scaledH > vpSize.h ? (scaledH - vpSize.h) / 2 : 0;

  return {
    tx: clamp(tx, -maxTx, maxTx),
    ty: clamp(ty, -maxTy, maxTy),
  };
}

/** Apply a CSS transform directly to the image element (no React re-render). */
function applyTransform(imgEl, tx, ty, scale, animated = false) {
  if (!imgEl) return;
  imgEl.style.transition = animated && !prefersReducedMotion()
    ? `transform ${ANIM_DURATION_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
    : 'none';
  imgEl.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function ImageViewer({ src: rawSrc, label = 'Photo', mediaRef, zoomApiRef, onToggleControls, isCurrent = true, closing = false }) {
  /*
   * Same reason as VideoViewer: a conversation attachment's `/api/media/` URL
   * cannot be authorized by an <img> tag inside the app, so it is signed first.
   * Non-conversation media passes through untouched.
   */
  const { src, failed: srcFailed, pending: srcPending, refresh: refreshSrc, recover: recoverSrc } = useSignedMediaSrc(rawSrc);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const wrapRef = useRef(null);
  const imgRef = useRef(null);

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [entering, setEntering] = useState(true);

  // ── Single source of truth: the transform state lives here, NOT in React state.
  // This avoids React re-renders on every pointer event frame.
  const xf = useRef({ scale: 1, tx: 0, ty: 0 });

  // ── Measured sizes (updated after load + on resize)
  const imgSize = useRef(null);   // { w, h } — rendered size at scale=1
  const vpSize = useRef(null);    // { w, h } — viewport (wrap) size

  // ── Drag state
  const drag = useRef(null); // { startX, startY, lastTx, lastTy, history: [{tx,ty,t}] }

  // ── Pinch state
  const pinch = useRef(null); // { dist, scale, midX, midY, tx, ty }

  // ── Momentum RAF
  const momentumRaf = useRef(null);

  // ── Double-tap detection: the last COMPLETED tap, { t, x, y } (t = 0: none).
  const lastTapRef = useRef({ t: 0, x: 0, y: 0 });

  // ── The single-finger touch in progress: { x, y, t, moved } (null: none).
  const touchRef = useRef(null);

  // ── Track whether user has dragged (to distinguish click from drag)
  const didDragRef = useRef(false);

  // ─────────────────────────────────────
  // Measure helpers
  // ─────────────────────────────────────

  const measureVp = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    vpSize.current = { w: wrap.clientWidth, h: wrap.clientHeight };
  }, []);

  // offset dimensions are independent of transforms; no style writes needed.
  const measureImg = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    if (w > 0 && h > 0) {
      imgSize.current = { w, h };
    }
  }, []);

  // ─────────────────────────────────────
  // Reset everything (on src change / close)
  // ─────────────────────────────────────

  const resetState = useCallback(() => {
    if (momentumRaf.current) {
      cancelAnimationFrame(momentumRaf.current);
      momentumRaf.current = null;
    }
    drag.current = null;
    pinch.current = null;
    didDragRef.current = false;
    touchRef.current = null;
    lastTapRef.current = { t: 0, x: 0, y: 0 };
    xf.current = { scale: 1, tx: 0, ty: 0 };
    applyTransform(imgRef.current, 0, 0, 1, false);
    if (wrapRef.current) wrapRef.current.removeAttribute('data-zoomed');
  }, []);

  useEffect(() => {
    // While the viewer is closing the image must stay exactly where the
    // dismiss drag left it; resetting here snapped it back to the centre
    // before the fade, which read as a jump.
    if (!isCurrent && !closing) {
      resetState();
    }
  }, [isCurrent, closing, resetState]);

  // ─────────────────────────────────────
  // Commit transform helper
  // ─────────────────────────────────────

  const commit = useCallback((animated = false) => {
    const { scale, tx, ty } = xf.current;
    const clamped = clampTranslation(tx, ty, scale, imgSize.current, vpSize.current);
    xf.current.tx = clamped.tx;
    xf.current.ty = clamped.ty;
    applyTransform(imgRef.current, clamped.tx, clamped.ty, scale, animated);
    
    if (wrapRef.current) {
      if (scale > 1.01) {
        wrapRef.current.setAttribute('data-zoomed', 'true');
      } else {
        wrapRef.current.removeAttribute('data-zoomed');
      }
    }
  }, []);

  // ─────────────────────────────────────
  // Momentum / inertia
  // ─────────────────────────────────────

  const stopMomentum = useCallback(() => {
    if (momentumRaf.current) {
      cancelAnimationFrame(momentumRaf.current);
      momentumRaf.current = null;
    }
  }, []);

  const startMomentum = useCallback((vx, vy) => {
    stopMomentum();
    // Coasting after a flick is motion the user did not ask to see.
    if (prefersReducedMotion()) return;
    if (Math.hypot(vx, vy) < MOMENTUM_MIN_SPEED) return;

    let cvx = vx;
    let cvy = vy;

    const step = () => {
      cvx *= MOMENTUM_FRICTION;
      cvy *= MOMENTUM_FRICTION;
      xf.current.tx += cvx;
      xf.current.ty += cvy;
      commit(false);
      if (Math.hypot(cvx, cvy) > MOMENTUM_MIN_SPEED) {
        momentumRaf.current = requestAnimationFrame(step);
      } else {
        momentumRaf.current = null;
      }
    };

    momentumRaf.current = requestAnimationFrame(step);
  }, [stopMomentum, commit]);

  // ─────────────────────────────────────
  // Double-tap / double-click zoom
  // ─────────────────────────────────────

  const doDoubleTap = useCallback((clientX, clientY) => {
    stopMomentum();
    const wrap = wrapRef.current;
    if (!wrap) return;

    if (xf.current.scale > 1) {
      // Second tap → reset to 1x
      xf.current = { scale: 1, tx: 0, ty: 0 };
      commit(true);
    } else {
      // First tap → zoom to DOUBLE_TAP_ZOOM around the tap point
      const rect = wrap.getBoundingClientRect();
      // Cursor position relative to image center
      const px = clientX - (rect.left + rect.width / 2);
      const py = clientY - (rect.top + rect.height / 2);

      const targetScale = DOUBLE_TAP_ZOOM;
      // The new translate must shift so that the tapped world-point stays under cursor.
      // At scale S, world point (px/oldScale) maps to screen as: tx + px/oldScale * newScale
      // We want that to stay at px on screen, so: tx' = px - px * newScale = px*(1 - newScale)
      xf.current.tx = px * (1 - targetScale);
      xf.current.ty = py * (1 - targetScale);
      xf.current.scale = targetScale;
      commit(true);
    }
  }, [stopMomentum, commit]);

  // ─────────────────────────────────────
  // Mouse wheel zoom
  // ─────────────────────────────────────

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    stopMomentum();

    const wrap = wrapRef.current;
    if (!wrap) return;

    // Normalize delta across trackpads and discrete scroll wheels.
    // deltaMode 0 = pixels, 1 = lines, 2 = pages
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 24;  // lines → pixels
    if (e.deltaMode === 2) delta *= 240; // pages → pixels

    // Clamp to avoid insane jumps from high-velocity trackpad flings
    delta = clamp(delta, -150, 150);

    // Convert to a scale multiplier (negative delta = zoom in)
    const factor = Math.exp(-delta * 0.003);
    const oldScale = xf.current.scale;
    const newScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
    if (newScale === oldScale) return;

    const rect = wrap.getBoundingClientRect();
    const px = e.clientX - (rect.left + rect.width / 2);
    const py = e.clientY - (rect.top + rect.height / 2);

    // Adjust translation so the point under the cursor stays fixed:
    // newTx = px - (px - oldTx) * (newScale / oldScale)
    const ratio = newScale / oldScale;
    xf.current.tx = px - (px - xf.current.tx) * ratio;
    xf.current.ty = py - (py - xf.current.ty) * ratio;
    xf.current.scale = newScale;

    // If we've hit min scale, snap translation to (0,0)
    if (newScale === MIN_SCALE) {
      xf.current.tx = 0;
      xf.current.ty = 0;
    }

    commit(false);
  }, [stopMomentum, commit]);

  // ─────────────────────────────────────
  // Mouse drag (pan)
  // ─────────────────────────────────────

  const handleMouseDown = useCallback((e) => {
    // Only left button
    if (e.button !== 0) return;
    // A drag flag left over from an earlier pan would swallow this click.
    didDragRef.current = false;
    // Only pan when zoomed
    if (xf.current.scale <= 1) return;

    e.preventDefault();
    stopMomentum();
    didDragRef.current = false;

    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      lastTx: xf.current.tx,
      lastTy: xf.current.ty,
      history: [{ tx: xf.current.tx, ty: xf.current.ty, t: performance.now() }],
    };

    // Update wrap cursor class directly without a re-render
    wrapRef.current?.classList.add(styles.grabbing);
  }, [stopMomentum]);

  const handleMouseMove = useCallback((e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;

    if (Math.hypot(dx, dy) > 3) didDragRef.current = true;

    xf.current.tx = drag.current.lastTx + dx;
    xf.current.ty = drag.current.lastTy + dy;
    commit(false);

    // Keep only recent history for velocity calculation
    const now = performance.now();
    drag.current.history.push({ tx: xf.current.tx, ty: xf.current.ty, t: now });
    // Trim old samples
    while (drag.current.history.length > 1 &&
           now - drag.current.history[0].t > MOMENTUM_HISTORY_MS) {
      drag.current.history.shift();
    }
  }, [commit]);

  const handleMouseUp = useCallback(() => {
    if (!drag.current) return;
    wrapRef.current?.classList.remove(styles.grabbing);

    const history = drag.current.history;
    drag.current = null;

    if (history.length >= 2) {
      const newest = history[history.length - 1];
      const oldest = history[0];
      const dt = newest.t - oldest.t;
      if (dt > 0) {
        const vx = (newest.tx - oldest.tx) / dt * 16; // px per frame at 60fps
        const vy = (newest.ty - oldest.ty) / dt * 16;
        startMomentum(vx, vy);
      }
    }
  }, [startMomentum]);

  // ─────────────────────────────────────
  // Touch gestures
  // ─────────────────────────────────────

  const handleTouchStart = useCallback((e) => {
    stopMomentum();

    if (e.touches.length >= 2) {
      // ── Pinch start
      e.preventDefault();
      drag.current = null; // cancel any active drag
      didDragRef.current = true; // suppress click
      // A pinch is never part of a tap, and ends any tap in progress.
      touchRef.current = null;
      lastTapRef.current = { t: 0, x: 0, y: 0 };

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const wrap = wrapRef.current;
      if (!wrap) return;

      const rect = wrap.getBoundingClientRect();
      const midX = (t1.clientX + t2.clientX) / 2 - (rect.left + rect.width / 2);
      const midY = (t1.clientY + t2.clientY) / 2 - (rect.top + rect.height / 2);

      pinch.current = {
        dist: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
        scale: xf.current.scale,
        midX,
        midY,
        tx: xf.current.tx,
        ty: xf.current.ty,
      };
    } else if (e.touches.length === 1) {
      // ── Single touch. Whether it is a tap is only known when it ENDS (it may
      // become a drag), so this just remembers where and when it began.
      const touch = e.touches[0];

      // Every new touch starts clean: a pinch or a double-tap earlier set this
      // to swallow the click that follows it, and leaving it set made every
      // later tap on the un-zoomed image a no-op.
      didDragRef.current = false;
      touchRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now(), moved: false };

      // Only start a drag if already zoomed
      if (xf.current.scale <= 1) return;

      drag.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastTx: xf.current.tx,
        lastTy: xf.current.ty,
        history: [{ tx: xf.current.tx, ty: xf.current.ty, t: performance.now() }],
      };
    }
  }, [stopMomentum]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2 && pinch.current) {
      // ── Pinch move
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const newDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const p = pinch.current;

      const rawScale = p.scale * (newDist / p.dist);
      const newScale = clamp(rawScale, MIN_SCALE, MAX_SCALE);

      // Keep the pinch midpoint fixed on screen
      const ratio = newScale / p.scale;
      xf.current.tx = p.midX - (p.midX - p.tx) * ratio;
      xf.current.ty = p.midY - (p.midY - p.ty) * ratio;
      xf.current.scale = newScale;

      if (newScale === MIN_SCALE) {
        xf.current.tx = 0;
        xf.current.ty = 0;
      }

      commit(false);
      return;
    }

    if (e.touches.length !== 1) return;

    // Moving past the slop turns the touch into a drag: it can no longer be
    // the tap half of a double-tap, however the finger leaves the screen.
    const touch = e.touches[0];
    const began = touchRef.current;
    if (began && !began.moved && Math.hypot(touch.clientX - began.x, touch.clientY - began.y) > TAP_SLOP_PX) {
      began.moved = true;
      lastTapRef.current = { t: 0, x: 0, y: 0 };
    }

    if (!drag.current) return;
    // ── Single-finger pan (only when zoomed)
    if (xf.current.scale <= 1) return;
    e.preventDefault();

    const dx = touch.clientX - drag.current.startX;
    const dy = touch.clientY - drag.current.startY;

    if (Math.hypot(dx, dy) > 3) didDragRef.current = true;

    xf.current.tx = drag.current.lastTx + dx;
    xf.current.ty = drag.current.lastTy + dy;
    commit(false);

    const now = performance.now();
    drag.current.history.push({ tx: xf.current.tx, ty: xf.current.ty, t: now });
    while (drag.current.history.length > 1 &&
           now - drag.current.history[0].t > MOMENTUM_HISTORY_MS) {
      drag.current.history.shift();
    }
  }, [commit]);

  const handleTouchEnd = useCallback((e) => {
    const began = touchRef.current;
    touchRef.current = null;

    if (pinch.current) {
      pinch.current = null;
      lastTapRef.current = { t: 0, x: 0, y: 0 };
      // After a pinch, if scale snapped to 1, reset translation
      if (xf.current.scale === MIN_SCALE) {
        xf.current.tx = 0;
        xf.current.ty = 0;
        commit(true);
      }
      return;
    }

    if (drag.current) {
      const history = drag.current.history;
      drag.current = null;

      if (history.length >= 2) {
        const newest = history[history.length - 1];
        const oldest = history[0];
        const dt = newest.t - oldest.t;
        if (dt > 0) {
          const vx = (newest.tx - oldest.tx) / dt * 16;
          const vy = (newest.ty - oldest.ty) / dt * 16;
          startMomentum(vx, vy);
        }
      }
    }

    // ── Tap recognition. A tap is a lone finger that stayed put and came up
    // quickly. Anything else - a swipe, a pan, a long press, a finger that was
    // one of several - is not a tap and breaks any double-tap in progress.
    const now = Date.now();
    const isTap = began && !began.moved && e.touches.length === 0 && now - began.t <= TAP_MAX_MS;
    if (!isTap) {
      lastTapRef.current = { t: 0, x: 0, y: 0 };
      return;
    }

    const prev = lastTapRef.current;
    const isDoubleTap = prev.t > 0
      && now - prev.t < DOUBLE_TAP_MS
      && Math.hypot(began.x - prev.x, began.y - prev.y) < DOUBLE_TAP_DISTANCE_PX;

    if (isDoubleTap) {
      lastTapRef.current = { t: 0, x: 0, y: 0 };
      // Swallow the click this touch would otherwise synthesize.
      if (e.cancelable) e.preventDefault();
      didDragRef.current = true;
      doDoubleTap(began.x, began.y);
    } else {
      lastTapRef.current = { t: now, x: began.x, y: began.y };
    }
  }, [commit, startMomentum, doDoubleTap]);

  /** The OS took the touch away (a system gesture, a call): nothing completed. */
  const handleTouchCancel = useCallback(() => {
    touchRef.current = null;
    pinch.current = null;
    drag.current = null;
    lastTapRef.current = { t: 0, x: 0, y: 0 };
  }, []);

  // ─────────────────────────────────────
  // Click handler (toggle controls, not drag)
  // ─────────────────────────────────────

  const handleClick = useCallback((e) => {
    if (didDragRef.current) return;
    onToggleControls?.();
  }, [onToggleControls]);

  const handleDoubleClick = useCallback((e) => {
    e.stopPropagation();
    doDoubleTap(e.clientX, e.clientY);
  }, [doDoubleTap]);

  // ─────────────────────────────────────
  // Image load
  // ─────────────────────────────────────

  const handleLoad = useCallback(() => {
    setLoaded(true);
    requestAnimationFrame(() => {
      setEntering(false);
      measureVp();
      measureImg();
    });
  }, [measureVp, measureImg]);

  const handleError = useCallback(() => {
    // A dead signature heals silently: the skeleton stays up while it re-signs.
    if (recoverSrc()) return;
    setLoaded(true);
    setError(true);
  }, [recoverSrc]);

  // ─────────────────────────────────────
  // Reset on src change
  // ─────────────────────────────────────

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setLoaded(true);
      setEntering(false);
      measureVp();
      measureImg();
    } else {
      setLoaded(false);
      setError(false);
      setEntering(true);
    }
    resetState();
  }, [src, retryAttempt, measureVp, measureImg, resetState]);

  // ─────────────────────────────────────
  // Resize handler
  // ─────────────────────────────────────

  useEffect(() => {
    const onResize = () => {
      measureVp();
      measureImg();
      // Re-clamp current transform
      const { scale, tx, ty } = xf.current;
      const clamped = clampTranslation(tx, ty, scale, imgSize.current, vpSize.current);
      xf.current.tx = clamped.tx;
      xf.current.ty = clamped.ty;
      applyTransform(imgRef.current, clamped.tx, clamped.ty, scale, false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureVp, measureImg]);

  // ─────────────────────────────────────
  // Imperative event listeners on the wrap element
  // ─────────────────────────────────────

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    // Wheel
    wrap.addEventListener('wheel', handleWheel, { passive: false });

    // Touch (must be non-passive to allow preventDefault)
    wrap.addEventListener('touchstart', handleTouchStart, { passive: false });
    wrap.addEventListener('touchmove', handleTouchMove, { passive: false });
    wrap.addEventListener('touchend', handleTouchEnd, { passive: false });
    wrap.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      wrap.removeEventListener('wheel', handleWheel);
      wrap.removeEventListener('touchstart', handleTouchStart);
      wrap.removeEventListener('touchmove', handleTouchMove);
      wrap.removeEventListener('touchend', handleTouchEnd);
      wrap.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel]);

  // Mouse move/up go on window so dragging outside the wrap still works
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // ─────────────────────────────────────
  // Keyboard zoom / pan (driven by MediaViewer's key handler and zoom buttons)
  // ─────────────────────────────────────

  const zoomBy = useCallback((factor) => {
    // Nothing to zoom until the image has loaded and been measured.
    if (!imgSize.current) return;
    stopMomentum();
    const old = xf.current.scale;
    let next = clamp(old * factor, MIN_SCALE, MAX_SCALE);
    // Zooming out lands exactly on 1x rather than an imperceptible 1.04x that
    // leaves the image "zoomed" for gesture purposes.
    if (next < 1.05) next = MIN_SCALE;
    if (next === old) return;

    // Zoom about the viewport centre, so the translation scales with it.
    const ratio = next / old;
    xf.current.scale = next;
    xf.current.tx = next === MIN_SCALE ? 0 : xf.current.tx * ratio;
    xf.current.ty = next === MIN_SCALE ? 0 : xf.current.ty * ratio;
    commit(true);
  }, [stopMomentum, commit]);

  const resetZoom = useCallback(() => {
    stopMomentum();
    if (xf.current.scale === MIN_SCALE && xf.current.tx === 0 && xf.current.ty === 0) return;
    xf.current = { scale: MIN_SCALE, tx: 0, ty: 0 };
    commit(true);
  }, [stopMomentum, commit]);

  /** Returns true when the image actually moved (false at the edge). */
  const panBy = useCallback((dx, dy) => {
    if (xf.current.scale <= 1.01) return false;
    stopMomentum();
    const { scale, tx, ty } = xf.current;
    const next = clampTranslation(tx + dx, ty + dy, scale, imgSize.current, vpSize.current);
    if (next.tx === tx && next.ty === ty) return false;
    xf.current.tx = next.tx;
    xf.current.ty = next.ty;
    commit(true);
    return true;
  }, [stopMomentum, commit]);

  useEffect(() => {
    if (!zoomApiRef) return undefined;
    const api = {
      zoomIn: () => zoomBy(KEY_ZOOM_STEP),
      zoomOut: () => zoomBy(1 / KEY_ZOOM_STEP),
      reset: resetZoom,
      panBy,
      isZoomed: () => xf.current.scale > 1.01,
    };
    zoomApiRef.current = api;
    return () => {
      if (zoomApiRef.current === api) zoomApiRef.current = null;
    };
  }, [zoomApiRef, zoomBy, resetZoom, panBy]);

  // ─────────────────────────────────────
  // Gesture target
  // ─────────────────────────────────────

  /*
   * The viewer's vertical dismiss drags whatever `mediaRef` points at and then
   * clears its transform. That must NOT be the <img>: the image's own transform
   * IS the zoom (translate + scale), so clearing it from outside un-zoomed the
   * picture on screen while this component still believed it was zoomed.
   *
   * It is the wrapper instead. The wrapper holds whichever state is showing - the
   * skeleton while loading, the image, or the "Media unavailable" card - so a
   * drag always moves what the user can see, and the zoom transform is left
   * alone. A video routed through here keeps its own gesture target (VideoViewer
   * claims it), so this stands down for it.
   *
   * No dependency list: it must re-assert after every commit, like VideoViewer's,
   * because the target should follow the visible state without a bookkeeping
   * list that can fall behind. The cleanup below only releases the ref when it
   * is still ours, so a neighbouring slide that has already claimed it keeps it.
   */
  const showsError = (error || srcFailed) && !srcPending;
  const isVideoSrc = typeof src === 'string' && (/\.(mp4|webm|mov|mkv|avi|flv)/i.test(src) || src.startsWith('data:video/'));
  const showsVideo = isVideoSrc && !showsError;
  useEffect(() => {
    if (!mediaRef || showsVideo) return;
    mediaRef.current = wrapRef.current;
  });

  useEffect(() => {
    if (!mediaRef) return undefined;
    const wrap = wrapRef.current;
    return () => {
      if (mediaRef.current === wrap) mediaRef.current = null;
    };
  }, [mediaRef]);

  // ─────────────────────────────────────
  // Cleanup on unmount
  // ─────────────────────────────────────

  useEffect(() => {
    return () => {
      stopMomentum();
    };
  }, [stopMomentum]);

  // ─────────────────────────────────────
  // Render
  // ─────────────────────────────────────

  return (
    <>
      <div
        ref={wrapRef}
        className={styles.imageWrap}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onClick={handleClick}
      >
        {!loaded && !error && !srcFailed && (
          <div className={styles.skeleton}>
            <div className={styles.skeletonRect} />
          </div>
        )}

        {showsError ? (
          <div className={styles.brokenWrap}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
              <line x1="4" y1="4" x2="20" y2="20" stroke="rgba(255,80,80,0.6)" strokeWidth="2" />
            </svg>
            <span>Media unavailable</span>
            <button type="button" className={styles.videoRetryBtn} onClick={(e) => {
              e.stopPropagation(); setError(false); setLoaded(false); setRetryAttempt(n => n + 1); refreshSrc();
            }}>Try again</button>
          </div>
        ) : showsVideo ? (
          <VideoViewer src={rawSrc} mediaRef={mediaRef} isCurrent={isCurrent} />
        ) : (
          <img
            key={retryAttempt}
            ref={(el) => {
              imgRef.current = el;
              if (el && el.complete && el.naturalWidth > 0 && !loaded) {
                setLoaded(true);
                setEntering(false);
                measureVp();
                measureImg();
              }
            }}
            src={src || undefined}
            alt={label}
            loading="eager"
            decoding="async"
            fetchpriority={isCurrent ? "high" : "auto"}
            className={`${styles.mediaImage} ${entering ? styles.entering : styles.entered}`}
            style={{ opacity: loaded ? 1 : 0 }}
            onLoad={handleLoad}
            onError={handleError}
            draggable={false}
          />
        )}
      </div>
    </>
  );
}
