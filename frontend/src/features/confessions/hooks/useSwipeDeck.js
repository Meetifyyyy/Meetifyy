import { startTransition, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { stepSpring } from '../../../mobile/openScreenMotion';

/** A drag past this share of the width, or a flick faster than this, turns the page. */
const TURN_DISTANCE = 0.2;
const TURN_SPEED = 450; // px per second
/** Past either end the deck still gives a little, then stops. */
const RUBBER = 0.3;
/** Movement before a touch is decided to be a swipe (or a vertical scroll). */
const SLOP = 8;
/** Velocity is measured over the last this-many ms of the drag. */
const VELOCITY_WINDOW = 100;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Recent pointer samples → velocity in px/s. */
function velocityOf(samples) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) {
    if (last.t - s.t <= VELOCITY_WINDOW) {
      first = s;
      break;
    }
  }
  const dt = last.t - first.t;
  return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0;
}

/**
 * Where every moving part of the deck sits at position `p` (slides, as a
 * decimal). Transform and opacity only, so a frame never needs layout or
 * paint: the compositor moves layers the browser already has.
 *
 * Each line of type and each graphic trails its slide by its own amount,
 * which is what staggers them as a slide arrives and leaves.
 */
function place(parts, p, count, vw) {
  if (parts.track) parts.track.style.transform = `translate3d(${((-p * 100) / count).toFixed(4)}%, 0, 0)`;
  parts.fills.forEach((el, n) => {
    if (el) el.style.transform = `scaleX(${clamp01(p - n + 1).toFixed(4)})`;
  });
  parts.slides.forEach((s, n) => {
    const d = p - n;
    const ad = Math.abs(d);
    // Two or more slides away it cannot be seen: leave it where it is.
    if (ad > 1.6 && s.placed) return;
    s.placed = true;
    if (s.art) {
      s.art.style.transform = `translate3d(${(d * -22 * vw).toFixed(2)}px, 0, 0) rotate(${(d * -6).toFixed(3)}deg) scale(${(1 - Math.min(ad, 1.5) * 0.12).toFixed(4)})`;
      s.art.style.opacity = clamp01(1 - ad * 0.9).toFixed(3);
    }
    if (s.eyebrow) {
      s.eyebrow.style.transform = `translate3d(${(d * 10 * vw).toFixed(2)}px, 0, 0)`;
      s.eyebrow.style.opacity = clamp01(1 - ad * 1.6).toFixed(3);
    }
    s.lines.forEach((el, i) => {
      el.style.transform = `translate3d(${(d * (14 + i * 12) * vw).toFixed(2)}px, 0, 0)`;
      el.style.opacity = clamp01(1 - ad * (1.3 + i * 0.3)).toFixed(3);
    });
    if (s.body) {
      s.body.style.transform = `translate3d(${(d * 40 * vw).toFixed(2)}px, 0, 0)`;
      s.body.style.opacity = clamp01(1 - ad * 2).toFixed(3);
    }
  });
}

/** The deck's moving elements, found once by their `data-deck` markers. */
function collect(root) {
  const q = (sel) => Array.from(root.querySelectorAll(sel));
  return {
    track: root.querySelector('[data-deck="track"]'),
    fills: q('[data-deck="fill"]'),
    slides: q('[data-deck="slide"]').map((slide) => ({
      placed: false,
      art: slide.querySelector('[data-deck="art"]'),
      eyebrow: slide.querySelector('[data-deck="eyebrow"]'),
      lines: Array.from(slide.querySelectorAll('[data-deck="line"]')),
      body: slide.querySelector('[data-deck="body"]'),
    })),
  };
}

/**
 * A horizontal pager with the same physics as the app's opening screen
 * (`mobile/openScreenMotion.js`): the slides follow the finger exactly while
 * it is down, and on release a critically damped spring carries them to the
 * slide the gesture chose, starting at the finger's own speed — a fast flick
 * turns the page however short it was, and the motion never stops dead.
 *
 * Every frame is written straight onto the elements as transforms (one rAF
 * per frame, no React render, no CSS custom property recalculated across the
 * tree, no scroll- or animation-timeline — those stall flings in the Android
 * WebView). React re-renders only when the target slide changes, at low
 * priority so it never holds up a frame.
 */
export function useSwipeDeck(count, { reduceMotion = false } = {}) {
  const last = count - 1;
  const rootRef = useRef(null);
  const viewportRef = useRef(null);
  const parts = useRef(null);
  const pos = useRef(0);
  const vel = useRef(0);
  const target = useRef(0);
  const frame = useRef(0);
  const drawFrame = useRef(0);
  const lastTime = useRef(0);
  const gesture = useRef(null);
  const [index, setIndex] = useState(0);

  const render = useCallback(() => {
    if (!parts.current) return;
    place(parts.current, pos.current, count, (window.innerWidth || 1) / 100);
  }, [count]);

  const stop = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  const tick = useCallback((now) => {
    const dt = lastTime.current ? (now - lastTime.current) / 1000 : 1 / 60;
    lastTime.current = now;
    const next = stepSpring({ x: pos.current, v: vel.current }, target.current, dt);
    pos.current = next.x;
    vel.current = next.v;
    if (Math.abs(next.x - target.current) < 0.0004 && Math.abs(next.v) < 0.01) {
      pos.current = target.current;
      vel.current = 0;
      frame.current = 0;
      render();
      return;
    }
    render();
    frame.current = requestAnimationFrame(tick);
  }, [render]);

  /** Spring to slide `to` from wherever the slides are, keeping their speed. */
  const goTo = useCallback((to, velocity = vel.current) => {
    const next = Math.max(0, Math.min(last, to));
    target.current = next;
    startTransition(() => setIndex(next));
    vel.current = velocity;
    if (reduceMotion || typeof requestAnimationFrame !== 'function') {
      stop();
      pos.current = next;
      vel.current = 0;
      render();
      return;
    }
    if (!frame.current) {
      lastTime.current = 0;
      frame.current = requestAnimationFrame(tick);
    }
  }, [last, reduceMotion, render, stop, tick]);

  // Placed before the first paint, so the deck is drawn complete in its first
  // frame; again when the screen size changes (offsets are in screen widths).
  useLayoutEffect(() => {
    if (rootRef.current) parts.current = collect(rootRef.current);
    render();
    const onResize = () => render();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      stop();
      if (drawFrame.current) cancelAnimationFrame(drawFrame.current);
      drawFrame.current = 0;
    };
  }, [render, stop]);

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Buttons inside the deck keep their own taps.
    if (e.target instanceof Element && e.target.closest('button, a, input, textarea')) return;
    gesture.current = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY,
      dragging: false, startX: 0, startPos: 0, samples: [],
    };
  }, []);

  const onPointerMove = useCallback((e) => {
    const g = gesture.current;
    const vp = viewportRef.current;
    if (!g || g.id !== e.pointerId || !vp) return;
    if (!g.dragging) {
      const dx0 = e.clientX - g.x0;
      const dy0 = e.clientY - g.y0;
      if (Math.abs(dx0) < SLOP && Math.abs(dy0) < SLOP) return;
      if (Math.abs(dy0) > Math.abs(dx0)) {
        gesture.current = null; // mostly vertical: not a swipe
        return;
      }
      // Picked up exactly where they are, mid-spring included, and measured
      // from here, so nothing jumps by the slop distance.
      stop();
      vel.current = 0;
      g.dragging = true;
      g.startX = e.clientX;
      g.startPos = pos.current;
      if (rootRef.current) rootRef.current.dataset.drag = 'true';
      vp.setPointerCapture?.(e.pointerId);
    }
    g.samples.push({ x: e.clientX, t: e.timeStamp });
    if (g.samples.length > 12) g.samples.shift();
    const width = vp.clientWidth || window.innerWidth || 1;
    let p = g.startPos - (e.clientX - g.startX) / width;
    if (p < 0) p *= RUBBER;
    else if (p > last) p = last + (p - last) * RUBBER;
    pos.current = p;
    // Several pointer events can arrive in one frame; draw once per frame.
    if (typeof requestAnimationFrame !== 'function') render();
    else if (!drawFrame.current) {
      drawFrame.current = requestAnimationFrame(() => {
        drawFrame.current = 0;
        render();
      });
    }
  }, [last, render, stop]);

  const onPointerEnd = useCallback((e) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!g.dragging) return;
    if (rootRef.current) delete rootRef.current.dataset.drag;
    if (drawFrame.current) {
      cancelAnimationFrame(drawFrame.current);
      drawFrame.current = 0;
    }
    const width = viewportRef.current?.clientWidth || window.innerWidth || 1;
    g.samples.push({ x: e.clientX, t: e.timeStamp });
    const speed = e.type === 'pointerup' ? velocityOf(g.samples) : 0; // px/s
    const p = pos.current;
    const moved = p - g.startPos;
    let to;
    if (Math.abs(speed) > TURN_SPEED) to = speed < 0 ? Math.floor(p) + 1 : Math.ceil(p) - 1;
    else if (e.type === 'pointerup' && moved > 0) to = Math.floor(p + 1 - TURN_DISTANCE);
    else if (e.type === 'pointerup' && moved < 0) to = Math.ceil(p - 1 + TURN_DISTANCE);
    else to = Math.round(p);
    // Never more than one slide from where it was picked up.
    to = Math.max(Math.floor(g.startPos) - 1, Math.min(Math.ceil(g.startPos) + 1, to));
    goTo(to, -speed / width);
  }, [goTo]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(target.current + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(target.current - 1); }
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
