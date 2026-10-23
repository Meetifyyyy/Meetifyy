import { useCallback, useRef, useState } from 'react';

/** A drag past this share of the width, or a flick faster than this, turns the page. */
const TURN_DISTANCE = 0.18;
const TURN_SPEED = 0.45; // px per ms
/** Past either end the deck still gives a little, then stops. */
const RUBBER = 0.3;

/**
 * A horizontal pager driven by ONE number, `--deck-pg`, written on the root
 * element: how far along the slides you are, as a decimal.
 *
 * A finger drag writes it on every move (and sets `data-drag`, which the
 * stylesheet uses to switch the transition off so it follows the thumb
 * exactly). Letting go, a button or a key sets it to a whole number and the
 * stylesheet animates it there — it is a registered property, which is what
 * lets it transition. Everything that moves (the track, each line of type,
 * each graphic) is a function of it, so the choreography can never disagree
 * with the gesture.
 *
 * Writing the property straight onto the element, rather than through state,
 * keeps a drag from re-rendering React on every pointer move.
 */
export function useSwipeDeck(count) {
  const last = count - 1;
  const rootRef = useRef(null);
  const viewportRef = useRef(null);
  const indexRef = useRef(0);
  const gestureRef = useRef(null);
  const [index, setIndex] = useState(0);

  const goTo = useCallback((target) => {
    const next = Math.max(0, Math.min(last, target));
    indexRef.current = next;
    setIndex(next);
    const el = rootRef.current;
    if (!el) return;
    delete el.dataset.drag;
    el.style.setProperty('--deck-pg', String(next));
  }, [last]);

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Buttons inside the deck keep their own taps.
    if (e.target instanceof Element && e.target.closest('button, a, input, textarea')) return;
    gestureRef.current = {
      id: e.pointerId, x: e.clientX, y: e.clientY,
      lastX: e.clientX, lastT: e.timeStamp, speed: 0, dragging: false,
    };
  }, []);

  const onPointerMove = useCallback((e) => {
    const g = gestureRef.current;
    const el = rootRef.current;
    const vp = viewportRef.current;
    if (!g || g.id !== e.pointerId || !el || !vp) return;
    const dx = e.clientX - g.x;
    if (!g.dragging) {
      const dy = e.clientY - g.y;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        gestureRef.current = null;
        return;
      }
      g.dragging = true;
      el.dataset.drag = 'true';
      vp.setPointerCapture?.(e.pointerId);
    }
    const width = vp.clientWidth || window.innerWidth || 1;
    let pg = indexRef.current - dx / width;
    if (pg < 0) pg *= RUBBER;
    else if (pg > last) pg = last + (pg - last) * RUBBER;
    el.style.setProperty('--deck-pg', pg.toFixed(4));
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.speed = (e.clientX - g.lastX) / dt;
    g.lastX = e.clientX;
    g.lastT = e.timeStamp;
  }, [last]);

  const onPointerEnd = useCallback((e) => {
    const g = gestureRef.current;
    if (!g || g.id !== e.pointerId) return;
    gestureRef.current = null;
    if (!g.dragging) return;
    const width = viewportRef.current?.clientWidth || window.innerWidth || 1;
    const dx = e.clientX - g.x;
    const flick = Math.abs(g.speed) > TURN_SPEED;
    const turned = e.type === 'pointerup' && (Math.abs(dx) > width * TURN_DISTANCE || flick);
    const direction = flick ? -Math.sign(g.speed) : -Math.sign(dx);
    goTo(turned ? indexRef.current + direction : indexRef.current);
  }, [goTo]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(indexRef.current + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(indexRef.current - 1); }
  }, [goTo]);

  return {
    index,
    goTo,
    rootRef,
    viewportRef,
    viewportHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
    onKeyDown,
  };
}
