import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The opening screen's slide motion, driven from JavaScript.
 *
 * WHY NOT CSS
 * It used to be one registered CSS property, `--pg`, animated by a CSS
 * transition and read by every moving element. That kept the maths in the
 * stylesheet, but it cost the smoothness:
 *   - a custom-property transition runs on the MAIN thread, and `--pg` was
 *     inherited, so every element on the screen was restyled every frame —
 *     any React or image work at the same moment dropped frames;
 *   - a release always played the same 720 ms curve, so a fast flick slammed
 *     from finger speed into a slow ease (the "snap");
 *   - grabbing a slide that was still moving restarted from the target slide.
 *
 * Now one number, the position (0..count-1, fractional between slides), is
 * held here and written as `transform` onto exactly the seven elements that
 * move (the track, three photo stages, three circles) — nothing else is
 * restyled, and transforms on their own layers are composited, not repainted.
 *
 *   - Dragging: the position follows the finger, written once per frame.
 *   - Letting go: a critically damped spring carries the position to the
 *     slide, starting at the finger's release velocity — no overshoot, no
 *     change of speed at the hand-over, so no snap.
 *   - Touching a moving slide picks it up exactly where it is.
 *   - Dots: the same spring, from wherever the position is now.
 */

/** A drag past this share of the width, or a flick faster than this, turns the page. */
const TURN_DISTANCE = 0.2;
const TURN_SPEED = 450; // px per second
/** Past either end the slides still give a little, then stop. */
const RUBBER = 0.35;
/** Movement before a touch counts as a drag (Android's touch slop is ~8dp). */
const SLOP = 8;
/** Velocity is measured over the last this-many ms of the gesture. */
const VELOCITY_WINDOW = 100;

/**
 * Spring: k and c for mass 1; c = 2√k is critical (fastest with no overshoot).
 * k is low enough that a typical release (half-way, finger at ~900 px/s) has
 * almost no acceleration at the hand-over: the slides keep the finger's speed
 * and then ease in, instead of being yanked forward (measured: 2.4x the
 * finger's per-frame step at k=190; ~1x here).
 */
const STIFFNESS = 120;
const DAMPING = 2 * Math.sqrt(STIFFNESS);
const STEP = 1 / 240; // integrate in 4 ms steps whatever the frame rate

/*
 * ── The circles ─────────────────────────────────────────────────────────
 *
 * Three anchor places, as fractions of the screen (so any size and either
 * orientation gets the same composition): top right, bottom right, and off the
 * left edge. Each slide puts a different circle in each place, and moving to
 * the next slide turns all three one place CLOCKWISE around the screen's
 * edges — interpolated in angle and distance from the centre, so a circle
 * travels round the edge instead of cutting across the content. A circle takes
 * the size of the place it is going to, so each one grows or shrinks on the
 * way.
 *
 * They never overlap: every frame, if any two would come within GAP px of
 * touching, all three are scaled down together just enough to keep them apart.
 * At rest that never happens on a phone; it is what keeps the middle of a move
 * (and odd sizes, tablets, landscape) clean.
 */

/** Anchors, in clockwise order; `r` is a fraction of the screen's short side. */
const ANCHORS = [
  { x: 0.98, y: 0.03, r: 0.42 }, // top right
  { x: 1.0, y: 1.0, r: 0.52 }, // bottom right
  { x: -0.08, y: 0.5, r: 0.34 }, // off the left edge
];
const GAP = 8;
/** How much a circle swells half-way through a move (fraction of its size). */
const SWELL = [0.12, -0.08, 0.1];

/** The largest a circle can be drawn, as a fraction of the short side. */
export const CIRCLE_MAX = Math.max(...ANCHORS.map((a) => a.r)) * (1 + Math.max(...SWELL));

function polar(anchor) {
  const u = anchor.x - 0.5;
  const v = anchor.y - 0.5;
  return { angle: Math.atan2(v, u), dist: Math.hypot(u, v) };
}

/** Circle i's centre and radius (px) at fractional slide position `pos`. */
function circleAt(i, pos, w, h, last) {
  const p = Math.max(0, Math.min(last, pos));
  const s = Math.min(last - 1, Math.floor(p));
  const t = last === 0 ? 0 : p - s;
  const from = ANCHORS[(i + s) % ANCHORS.length];
  const to = ANCHORS[(i + s + 1) % ANCHORS.length];
  const a = polar(from);
  const b = polar(to);
  let delta = b.angle - a.angle;
  while (delta <= 0) delta += Math.PI * 2; // always clockwise
  const angle = a.angle + delta * t;
  const dist = a.dist + (b.dist - a.dist) * t;
  const short = Math.min(w, h);
  const r = (from.r + (to.r - from.r) * t) * short * (1 + SWELL[i] * 4 * t * (1 - t));
  return {
    x: (0.5 + Math.cos(angle) * dist) * w,
    y: (0.5 + Math.sin(angle) * dist) * h,
    r,
  };
}

/** All three circles at `pos`, shrunk together if any two would touch. */
export function circlesAt(pos, w, h, last) {
  const cs = ANCHORS.map((_, i) => circleAt(i, pos, w, h, last));
  let f = 1;
  for (let i = 0; i < cs.length; i += 1) {
    for (let j = i + 1; j < cs.length; j += 1) {
      const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
      const room = (d - GAP) / (cs[i].r + cs[j].r);
      if (room < f) f = room;
    }
  }
  f = Math.max(0.15, Math.min(1, f));
  return cs.map((c) => ({ x: c.x, y: c.y, r: c.r * f }));
}

/** The transform for a circle element whose box is `size` px square at (0, 0). */
function circleTransform(c, size) {
  const half = size / 2;
  return `translate3d(${(c.x - half).toFixed(2)}px, ${(c.y - half).toFixed(2)}px, 0) scale(${(c.r / half).toFixed(4)})`;
}

/** Advances a spring by `dt` seconds towards `target`; returns the new state. */
export function stepSpring(state, target, dt) {
  let { x, v } = state;
  let remaining = Math.min(dt, 0.064); // a long stall must not fling it
  while (remaining > 1e-6) {
    const h = Math.min(STEP, remaining);
    const a = -STIFFNESS * (x - target) - DAMPING * v;
    v += a * h; // semi-implicit Euler: stable at this step size
    x += v * h;
    remaining -= h;
  }
  return { x, v };
}

/** Recent pointer samples → velocity in px/s over the last VELOCITY_WINDOW ms. */
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
 * @param {object} o
 * @param {number} o.count          number of slides
 * @param {boolean} o.reduceMotion  jump instead of animating
 * @param {(i: number) => void} o.onTarget  the slide being moved to changed
 * @param {number} [o.autoAdvanceMs]  turn to the next slide by itself after this
 *   long (0 or absent: never). It goes through `goTo`, so it is the same spring
 *   as a swipe, and after the last slide it loops back to the first. It waits
 *   while a finger is down, starts its count again from every swipe or dot tap,
 *   is off under `reduceMotion`, and does nothing while the page is hidden.
 */
export function useSlidePager({ count, reduceMotion, onTarget, autoAdvanceMs = 0 }) {
  const last = count - 1;
  const rootRef = useRef(null);
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const stagesRef = useRef([]);
  const circlesRef = useRef([]);

  const pos = useRef(0);
  const vel = useRef(0); // slides per second
  const target = useRef(0);
  const frame = useRef(0);
  const lastTime = useRef(0);
  const gesture = useRef(null);
  const [index, setIndex] = useState(0);

  const onTargetRef = useRef(onTarget);
  onTargetRef.current = onTarget;

  const render = useCallback(() => {
    const p = pos.current;
    const vw = window.innerWidth || 1;
    const track = trackRef.current;
    if (track) track.style.transform = `translate3d(${(-p * 100) / count}%, 0, 0)`;
    stagesRef.current.forEach((el, n) => {
      // Parallax: the photos trail their slide by 9% of the screen width.
      if (el) el.style.transform = `translate3d(${((p - n) * 0.09 * vw).toFixed(2)}px, 0, 0)`;
    });
    const w = vw;
    const h = window.innerHeight || 1;
    const size = Math.ceil(CIRCLE_MAX * Math.min(w, h) * 2);
    const circles = circlesAt(p, w, h, count - 1);
    circlesRef.current.forEach((el, i) => {
      if (!el) return;
      // The box is sized once per screen size; every frame only transforms it.
      if (el.dataset.size !== String(size)) {
        el.dataset.size = String(size);
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
      }
      el.style.transform = circleTransform(circles[i], size);
    });
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

  const aim = useCallback((to) => {
    const next = Math.max(0, Math.min(last, to));
    target.current = next;
    if (rootRef.current) rootRef.current.dataset.target = String(next);
    // Low priority: re-rendering the dots and the two affected slides must
    // never hold up the animation frames that start in this same moment.
    startTransition(() => {
      setIndex(next);
      onTargetRef.current?.(next);
    });
    return next;
  }, [last]);

  // Auto-advance. `schedule` is the only thing that arms the timer and it always
  // clears the previous one first, so calling it again is "start the count again".
  const autoTimer = useRef(0);
  const goToRef = useRef(null);
  const autoOn = autoAdvanceMs > 0 && !reduceMotion && count > 1;

  const clearAuto = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = 0;
  }, []);

  const schedule = useCallback(() => {
    clearAuto();
    if (!autoOn) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (gesture.current) return; // a finger is down: it restarts on release
    autoTimer.current = setTimeout(() => {
      autoTimer.current = 0;
      if (gesture.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // Past the last slide, back to the first.
      goToRef.current?.(target.current >= last ? 0 : target.current + 1, 0);
    }, autoAdvanceMs);
  }, [autoOn, autoAdvanceMs, clearAuto, last]);
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  /** Spring to slide `to` from wherever the position is now, keeping its speed. */
  const goTo = useCallback((to, velocity = vel.current) => {
    aim(to);
    scheduleRef.current();
    vel.current = velocity;
    if (reduceMotion || typeof requestAnimationFrame !== 'function') {
      stop();
      pos.current = target.current;
      vel.current = 0;
      render();
      return;
    }
    if (!frame.current) {
      lastTime.current = 0;
      frame.current = requestAnimationFrame(tick);
    }
  }, [aim, reduceMotion, render, stop, tick]);
  goToRef.current = goTo;

  useEffect(() => {
    schedule();
    if (!autoOn || typeof document === 'undefined') return clearAuto;
    // A hidden page stops; coming back starts a fresh count rather than firing
    // at once because the timer would have elapsed in the background.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clearAuto();
      else schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearAuto();
    };
  }, [schedule, autoOn, clearAuto]);

  // Place everything before the first paint, and again when the screen size
  // changes (the parallax and the circles are laid out from it).
  useLayoutEffect(() => {
    render();
    const onResize = () => render();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      stop();
    };
  }, [render, stop]);

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearAuto(); // paused while touched
    gesture.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      dragging: false,
      startX: 0,
      startPos: 0,
      samples: [],
    };
  }, [clearAuto]);

  const drawFrame = useRef(0);
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
      // Pick the slides up exactly where they are — mid-animation included —
      // and measure from here, so nothing jumps by the slop distance.
      stop();
      vel.current = 0;
      g.dragging = true;
      g.startX = e.clientX;
      g.startPos = pos.current;
      if (rootRef.current) rootRef.current.dataset.drag = 'true';
      // Capture can be refused: the pointer may already be gone (the browser
      // took the gesture for a scroll and cancelled it, or the event is
      // synthetic), and Chromium then throws NotFoundError
      // (MEETIFYY-ANDROID-8). The drag works without it; pointercancel and
      // pointerup still end it.
      try {
        vp.setPointerCapture?.(e.pointerId);
      } catch {
        // Not capturing: nothing else depends on it.
      }
    }
    g.samples.push({ x: e.clientX, t: e.timeStamp });
    if (g.samples.length > 12) g.samples.shift();

    const width = vp.clientWidth || window.innerWidth || 1;
    let p = g.startPos - (e.clientX - g.startX) / width;
    if (p < 0) p *= RUBBER;
    else if (p > last) p = last + (p - last) * RUBBER;
    pos.current = p;
    // Several pointer events can arrive per frame; draw once per frame.
    if (!drawFrame.current && typeof requestAnimationFrame === 'function') {
      drawFrame.current = requestAnimationFrame(() => {
        drawFrame.current = 0;
        render();
      });
    } else if (typeof requestAnimationFrame !== 'function') {
      render();
    }
  }, [last, render, stop]);

  const onPointerEnd = useCallback((e) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) {
      // A touch that turned out to be a vertical scroll dropped its gesture
      // early; its end is what lets the count start again.
      if (!g) scheduleRef.current();
      return;
    }
    gesture.current = null;
    if (!g.dragging) {
      scheduleRef.current(); // a tap, not a drag
      return;
    }
    if (rootRef.current) delete rootRef.current.dataset.drag;
    if (drawFrame.current) {
      cancelAnimationFrame(drawFrame.current);
      drawFrame.current = 0;
    }
    const width = viewportRef.current?.clientWidth || window.innerWidth || 1;
    g.samples.push({ x: e.clientX, t: e.timeStamp });
    const speed = e.type === 'pointerup' ? velocityOf(g.samples) : 0; // px/s
    const p = pos.current;
    const moved = p - g.startPos; // + when dragged forward (finger to the left)
    // Decided from where the slides ARE, not from the slide they were heading
    // for: a second swipe made while the first is still settling must carry on
    // in its own direction, never turn back.
    let to;
    if (Math.abs(speed) > TURN_SPEED) {
      // A flick: the next slide in its direction from here.
      to = speed < 0 ? Math.floor(p) + 1 : Math.ceil(p) - 1;
    } else if (e.type === 'pointerup' && moved > 0) {
      to = Math.floor(p + 1 - TURN_DISTANCE); // forward once past 20%
    } else if (e.type === 'pointerup' && moved < 0) {
      to = Math.ceil(p - 1 + TURN_DISTANCE); // back once past 20%
    } else {
      to = Math.round(p); // cancelled, or no net movement: the nearest
    }
    // Never more than one slide from where it was picked up.
    to = Math.max(Math.floor(g.startPos) - 1, Math.min(Math.ceil(g.startPos) + 1, to));
    // The spring starts at the finger's speed (px/s → slides/s; left is +).
    goTo(to, -speed / width);
  }, [goTo]);

  const registerStage = useCallback((n, el) => {
    stagesRef.current[n] = el;
    if (el) el.style.transform = `translate3d(${((pos.current - n) * 0.09 * (window.innerWidth || 1)).toFixed(2)}px, 0, 0)`;
  }, []);

  const registerCircle = useCallback((i, el) => {
    circlesRef.current[i] = el;
  }, []);

  // Images on slides 2 and 3 are off screen at first; decode them now so the
  // first swipe never shows one popping in.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const img of root.querySelectorAll('img')) {
      if (typeof img.decode === 'function') img.decode().catch(() => {});
    }
  }, []);

  return {
    index,
    goTo,
    rootRef,
    viewportRef,
    trackRef,
    registerStage,
    registerCircle,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  };
}
