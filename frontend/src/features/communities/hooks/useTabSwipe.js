import { useEffect, useRef } from 'react';

/** How long the slide between two panes takes (CommunitiesRoute.module.css matches). */
export const PANE_SLIDE_MS = 300;

/** A horizontal move shorter than this decides nothing yet. */
const START_SLOP_PX = 8;
/** Past this share of the width, a release switches panes. */
const SWITCH_FRACTION = 0.25;
/** Or a flick at least this fast (px per ms). */
const SWITCH_SPEED = 0.45;
/** At the first or last pane the drag is held back to this share of the finger. */
const EDGE_RESISTANCE = 0.3;

/**
 * Ends a slide: both panes stop being shown, the inline offsets go, and the
 * resting layout (only the active pane, no transform) takes over. Called after
 * the transition; `timer` is the caller's ref so a newer slide cancels it.
 */
export function settleAfter(timer, track, tabs) {
  window.clearTimeout(timer.current);
  timer.current = window.setTimeout(() => {
    if (track) {
      delete track.dataset.moving;
      track.style.removeProperty('--tab-index');
      track.style.removeProperty('--drag');
    }
    tabs?.style.removeProperty('--tab-progress');
  }, PANE_SLIDE_MS + 40);
}

/**
 * Swiping the content sideways switches between the panes beside it.
 *
 * The strip of panes (`trackRef`) follows the finger, and the tab indicator
 * (`tabsRef`, through `--tab-progress`) follows it too; on release the strip
 * eases to whichever pane the swipe was heading for, or back. Only the CSS
 * variables move per frame, written once per animation frame, so nothing
 * re-renders while dragging.
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

    let pointerId = null;
    let mode = 'idle'; // idle | pending | drag
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let dx = 0;
    let width = 1;
    let frame = 0;

    const paint = () => {
      frame = 0;
      trackRef.current?.style.setProperty('--drag', `${dx}px`);
      tabsRef.current?.style.setProperty('--tab-progress', String(indexRef.current - dx / width));
    };

    const begin = () => {
      mode = 'drag';
      width = viewport.clientWidth || 1;
      callbacks.current.onStart?.();
      window.clearTimeout(timer.current);
      const track = trackRef.current;
      if (track) {
        track.dataset.moving = '1';
        track.dataset.dragging = '1';
        track.style.setProperty('--tab-index', String(indexRef.current));
        track.style.setProperty('--drag', '0px');
      }
      tabsRef.current?.setAttribute('data-dragging', '');
      try { viewport.setPointerCapture(pointerId); } catch { /* the pointer is already gone */ }
    };

    const onDown = (e) => {
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      lastX = e.clientX;
      startY = e.clientY;
      lastT = e.timeStamp;
      velocity = 0;
      dx = 0;
      mode = 'pending';
    };

    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      if (mode === 'pending') {
        if (Math.abs(mx) < START_SLOP_PX && Math.abs(my) < START_SLOP_PX) return;
        if (Math.abs(mx) > Math.abs(my) * 1.2) begin();
        else { mode = 'idle'; pointerId = null; return; }
      }
      if (mode !== 'drag') return;
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = 0.8 * velocity + 0.2 * ((e.clientX - lastX) / dt);
      lastX = e.clientX;
      lastT = e.timeStamp;
      const i = indexRef.current;
      const holdBack = (i === 0 && mx > 0) || (i === count - 1 && mx < 0);
      dx = holdBack ? mx * EDGE_RESISTANCE : mx;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onEnd = (e, cancelled) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (mode !== 'drag') { mode = 'idle'; return; }
      mode = 'idle';
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      const i = indexRef.current;
      let target = i;
      if (!cancelled) {
        if ((dx < -width * SWITCH_FRACTION || velocity < -SWITCH_SPEED) && i < count - 1) target = i + 1;
        else if ((dx > width * SWITCH_FRACTION || velocity > SWITCH_SPEED) && i > 0) target = i - 1;
      }
      const track = trackRef.current;
      const tabs = tabsRef.current;
      // Let go of the drag: the strip's transition now carries it from where
      // the finger left it to the pane it is heading for.
      if (track) {
        delete track.dataset.dragging;
        track.style.setProperty('--tab-index', String(target));
        track.style.setProperty('--drag', '0px');
      }
      tabs?.removeAttribute('data-dragging');
      tabs?.style.setProperty('--tab-progress', String(target));
      dx = 0;
      settleAfter(timer, track, tabs);
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
      if (frame) cancelAnimationFrame(frame);
    };
  }, [viewportRef, trackRef, tabsRef, count, timer]);

  return committed;
}
