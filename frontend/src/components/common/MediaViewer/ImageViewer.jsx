import { useState, useRef, useEffect, useCallback } from 'react';
import styles from './MediaViewer.module.css';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 280;
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
  imgEl.style.transition = animated
    ? `transform ${ANIM_DURATION_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
    : 'none';
  imgEl.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function ImageViewer({ src, onToggleControls, preloadNext, preloadPrev }) {
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

  // ── Double-tap detection
  const lastTapRef = useRef(0);

  // ── Track whether user has dragged (to distinguish click from drag)
  const didDragRef = useRef(false);

  // ── Whether an animated transition is in progress
  const animatingRef = useRef(false);

  // ─────────────────────────────────────
  // Measure helpers
  // ─────────────────────────────────────

  const measureVp = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    vpSize.current = { w: wrap.clientWidth, h: wrap.clientHeight };
  }, []);

  /**
   * Measure the rendered image size AT SCALE=1.
   * We temporarily zero out the transform so offsetWidth/Height return the
   * natural CSS-constrained size, then restore it. This is one forced reflow
   * but only happens on load and resize — never during gesture tracking.
   */
  const measureImg = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const saved = img.style.transform;
    img.style.transform = 'translate3d(0,0,0) scale(1)';
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    img.style.transform = saved;
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
    animatingRef.current = false;
    xf.current = { scale: 1, tx: 0, ty: 0 };
    applyTransform(imgRef.current, 0, 0, 1, false);
  }, []);

  // ─────────────────────────────────────
  // Commit transform helper
  // ─────────────────────────────────────

  const commit = useCallback((animated = false) => {
    const { scale, tx, ty } = xf.current;
    const clamped = clampTranslation(tx, ty, scale, imgSize.current, vpSize.current);
    xf.current.tx = clamped.tx;
    xf.current.ty = clamped.ty;
    applyTransform(imgRef.current, clamped.tx, clamped.ty, scale, animated);
    if (animated) {
      animatingRef.current = true;
      setTimeout(() => { animatingRef.current = false; }, ANIM_DURATION_MS + 10);
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

    if (e.touches.length === 2) {
      // ── Pinch start
      e.preventDefault();
      drag.current = null; // cancel any active drag
      didDragRef.current = true; // suppress click

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
      // ── Single touch: detect double-tap or start drag
      const touch = e.touches[0];
      const now = Date.now();

      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        // Double-tap
        e.preventDefault();
        lastTapRef.current = 0;
        didDragRef.current = true;
        doDoubleTap(touch.clientX, touch.clientY);
        return;
      }
      lastTapRef.current = now;

      // Only start a drag if already zoomed
      if (xf.current.scale <= 1) return;

      didDragRef.current = false;
      drag.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastTx: xf.current.tx,
        lastTy: xf.current.ty,
        history: [{ tx: xf.current.tx, ty: xf.current.ty, t: performance.now() }],
      };
    }
  }, [stopMomentum, doDoubleTap]);

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
    } else if (e.touches.length === 1 && drag.current) {
      // ── Single-finger pan (only when zoomed)
      if (xf.current.scale <= 1) return;
      e.preventDefault();

      const touch = e.touches[0];
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
    }
  }, [commit]);

  const handleTouchEnd = useCallback((e) => {
    if (pinch.current) {
      pinch.current = null;
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
  }, [commit, startMomentum]);

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
    setLoaded(true);
    setError(true);
  }, []);

  // ─────────────────────────────────────
  // Reset on src change (unmount + remount via key, but also guard here)
  // ─────────────────────────────────────

  useEffect(() => {
    setLoaded(false);
    setError(false);
    setEntering(true);
    resetState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

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
    wrap.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      wrap.removeEventListener('wheel', handleWheel);
      wrap.removeEventListener('touchstart', handleTouchStart);
      wrap.removeEventListener('touchmove', handleTouchMove);
      wrap.removeEventListener('touchend', handleTouchEnd);
      wrap.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd]);

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
        {!loaded && !error && (
          <div className={styles.skeleton}>
            <div className={styles.skeletonRect} />
          </div>
        )}

        {error ? (
          <div className={styles.brokenWrap}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
              <line x1="4" y1="4" x2="20" y2="20" stroke="rgba(255,80,80,0.6)" strokeWidth="2" />
            </svg>
            <span>Media unavailable</span>
          </div>
        ) : (
          <img
            ref={imgRef}
            src={src}
            alt="Media"
            className={`${styles.mediaImage} ${entering ? styles.entering : styles.entered}`}
            style={{ opacity: loaded ? 1 : 0 }}
            onLoad={handleLoad}
            onError={handleError}
            draggable={false}
          />
        )}
      </div>

      {preloadNext && <link rel="preload" as="image" href={preloadNext} />}
      {preloadPrev && <link rel="preload" as="image" href={preloadPrev} />}
    </>
  );
}
