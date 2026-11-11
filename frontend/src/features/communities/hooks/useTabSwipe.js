import { useEffect, useRef } from 'react';
import { createGestureSpring, releaseVelocity, rubberBand } from '@shared/lib/gestureSpring';

/** How long the slide between two panes takes (CommunitiesRoute.module.css matches). */
export const PANE_SLIDE_MS = 300;

/** A horizontal move shorter than this decides nothing yet. */
const START_SLOP_PX = 8;
/** Past this share of the width, a release switches panes. */
const SWITCH_FRACTION = 0.25;
/** Or a flick at least this fast (px per second). */
const SWITCH_SPEED = 450;
/** Past the first or last pane the strip stretches at most this share of the width. */
const EDGE_STRETCH = 0.18;

/**
 * Ends a slide: both panes stop being shown, the inline offsets go, and the
 * resting layout (only the active pane, no transform) takes over. Called after
 * the transition; `timer` is the caller's ref so a newer slide cancels it.
 */
export function settleAfter(timer, track, tabs, delay = PANE_SLIDE_MS + 40) {
  window.clearTimeout(timer.current);
  timer.current = window.setTimeout(() => {
    if (track) {
      delete track.dataset.moving;
      track.style.removeProperty('--tab-index');
      track.style.removeProperty('--drag');
      track.style.removeProperty('--leave-shift');
      track.style.removeProperty('--enter-shift');
    }
    tabs?.style.removeProperty('--tab-progress');
  }, delay);
}

/**
 * Swiping the content sideways switches between the panes beside it.
 *
 * Two phases, as a gesture should have:
 * - While the finger is down the strip of panes (`trackRef`) moves with it
 *   1:1: its `transform` is written directly on every move. Not a CSS custom
 *   property — those inherit, so changing one on the track restyled every
 *   community card inside it on every frame. The tab indicator still follows
 *   through `--tab-progress`, which only the two-tab strip inherits.
 * - On release a spring carries the strip to the pane the swipe chose (or
 *   back), starting at the finger's own speed: a flick lands fast, a slow drag
 *   settles gently. A touch that lands while it is still moving picks the
 *   strip up exactly where it is.
 *
 * The viewport has `touch-action: pan-y`: the browser keeps vertical scrolling
 * and leaves horizontal movement to this code, so a sideways swipe is not
 * cancelled halfway. A touch that starts out more vertical than sideways is
 * left alone. Mouse input is ignored (the tabs are the way there with a mouse).
 *
 * `onCommit(index)` is called when a release switches panes. `committed.current`
 * is set to true just before it, so the page's own tab-change handling knows
 * the slide has already started and must not restart it.
 */
export function useTabSwipe({ viewportRef, trackRef, tabsRef, index, count, onStart, onCommit, timer }) {
  const indexRef = useRef(index);
  indexRef.current = index;
  const callbacks = useRef({ onStart, onCommit });
  callbacks.current = { onStart, onCommit };
  const committed = useRef(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof window === 'undefined') return undefined;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let pointerId = null;
    let mode = 'idle'; // idle | pending | drag
    let startX = 0;
    let startY = 0;
    let samples = [];
    let width = 1;
    /** Distance between two panes' resting positions (pane width + gap). */
    let stride = 1;
    /** The strip's offset when this drag picked it up, relative to its pane. */
    let pickedUp = 0;
    let dx = 0;

    /** Strip position in px (0 = first pane), painted onto the elements. */
    const paint = (x) => {
      const track = trackRef.current;
      if (track) track.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
      tabsRef.current?.style.setProperty('--tab-progress', (-x / stride).toFixed(4));
    };
    const spring = createGestureSpring(paint, { stiffness: 380, dampingRatio: 1 });

    const finish = () => {
      const track = trackRef.current;
      if (track) {
        delete track.dataset.dragging;
        track.style.transform = '';
      }
      tabsRef.current?.removeAttribute('data-dragging');
      // A short grace so a commit render that lands after an instant (reduced
      // motion) settle still finds its slide state to clear.
      settleAfter(timer, track, tabsRef.current, 40);
    };

    const measure = () => {
      width = viewport.clientWidth || 1;
      const track = trackRef.current;
      const gap = track ? Number.parseFloat(getComputedStyle(track).columnGap) || 0 : 0;
      stride = width + gap;
    };

    const begin = () => {
      mode = 'drag';
      const wasMoving = spring.isMoving();
      measure();
      // Caught mid-slide: continue from where the strip visibly is.
      pickedUp = wasMoving ? spring.value() + indexRef.current * stride : 0;
      spring.stop();
      callbacks.current.onStart?.();
      window.clearTimeout(timer.current);
      const track = trackRef.current;
      if (track) {
        track.dataset.moving = '1';
        track.dataset.dragging = '1';
        track.style.setProperty('--tab-index', String(indexRef.current));
      }
      tabsRef.current?.setAttribute('data-dragging', '');
      spring.set(-indexRef.current * stride + pickedUp);
      try { viewport.setPointerCapture(pointerId); } catch { /* the pointer is already gone */ }
    };

    const onDown = (e) => {
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      samples = [];
      dx = 0;
      mode = 'pending';
    };

    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      if (mode === 'pending') {
        if (Math.abs(mx) < START_SLOP_PX && Math.abs(my) < START_SLOP_PX) return;
        if (Math.abs(mx) > Math.abs(my) * 1.2) {
          begin();
          // Measured from here, so the strip does not jump by the slop.
          startX = e.clientX;
        } else { mode = 'idle'; pointerId = null; return; }
      }
      if (mode !== 'drag') return;
      samples.push({ x: e.clientX, t: e.timeStamp });
      if (samples.length > 12) samples.shift();
      const i = indexRef.current;
      const raw = pickedUp + (e.clientX - startX);
      // Past the first or last pane it stretches instead of stopping dead.
      if (i === 0 && raw > 0) dx = rubberBand(raw, width * EDGE_STRETCH);
      else if (i === count - 1 && raw < 0) dx = -rubberBand(-raw, width * EDGE_STRETCH);
      else dx = raw;
      spring.set(-i * stride + dx);
    };

    const onEnd = (e, cancelled) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (mode !== 'drag') { mode = 'idle'; return; }
      mode = 'idle';
      const velocity = cancelled ? 0 : releaseVelocity(samples); // px/s
      const i = indexRef.current;
      let target = i;
      if (!cancelled) {
        if ((dx < -width * SWITCH_FRACTION || velocity < -SWITCH_SPEED) && i < count - 1) target = i + 1;
        else if ((dx > width * SWITCH_FRACTION || velocity > SWITCH_SPEED) && i > 0) target = i - 1;
      }
      const track = trackRef.current;
      if (track) track.style.setProperty('--tab-index', String(target));
      tabsRef.current?.style.setProperty('--tab-progress', String(target));
      dx = 0;
      spring.to(-target * stride, { velocity, instant: reduceMotion?.matches, done: finish });
      if (target !== i) {
        committed.current = true;
        callbacks.current.onCommit?.(target);
      }
    };

    const up = (e) => onEnd(e, false);
    const cancel = (e) => onEnd(e, true);

    viewport.addEventListener('pointerdown', onDown);
    viewport.addEventListener('pointermove', onMove);
    viewport.addEventListener('pointerup', up);
    viewport.addEventListener('pointercancel', cancel);
    return () => {
      viewport.removeEventListener('pointerdown', onDown);
      viewport.removeEventListener('pointermove', onMove);
      viewport.removeEventListener('pointerup', up);
      viewport.removeEventListener('pointercancel', cancel);
      spring.stop();
    };
  }, [viewportRef, trackRef, tabsRef, count, timer]);

  return committed;
}
