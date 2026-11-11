/**
 * The release half of a gesture: a spring that starts at the finger's speed.
 *
 * While a finger is down, gesture code writes the element's position straight
 * from the touch (1:1, no easing). When it lifts, this takes over and carries
 * the value to its target, seeded with the release velocity, so a fast flick
 * leaves the finger fast and a slow drag settles gently. A fixed-duration ease
 * makes every release land identically, which reads as fake.
 *
 * It is interruptible by construction: `value()` and `velocity()` report where
 * it is mid-flight, and calling `to()` again retargets it keeping its current
 * speed, so a touch that catches it continues from where it visibly is.
 *
 * `to(target, { until })` finishes early, without snapping to the target, the
 * first frame `until(value)` holds — e.g. a sheet sliding off is done once it
 * is wholly off screen; the spring's long tail past that is invisible.
 *
 * Units are whatever the caller uses (px, slides). `write(x)` is called once
 * per frame and must only set transform/opacity, never trigger layout.
 */

/**
 * A spring that comes to rest has moved something on screen without any DOM
 * change or `transitionend`, which is what the Android app's system bars
 * re-sample on (mobile/installSystemBars.js). It asks for that sample itself,
 * so a sheet that settles, or a page strip that lands, never leaves a bar in
 * the colour it read mid-motion.
 */
function announceSettled() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('meetifyy:system-bars-resample'));
  }
}

/** Integrate in 4 ms steps whatever the frame rate, so 60 and 120 Hz agree. */
const STEP = 1 / 240;

/**
 * @param {(x: number) => void} write  paints the value
 * @param {{ stiffness?: number, dampingRatio?: number, restDelta?: number }} [opts]
 *   dampingRatio 1 is critically damped (no overshoot); below 1 bounces.
 */
export function createGestureSpring(write, { stiffness = 500, dampingRatio = 1, restDelta = 0.5 } = {}) {
  let x = 0;
  let v = 0;
  let target = 0;
  let k = stiffness;
  let c = 2 * dampingRatio * Math.sqrt(stiffness);
  let frame = 0;
  let last = 0;
  let onRest = null;
  /** Optional early finish: stop as soon as this holds for the value. */
  let until = null;

  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;

  const finishEarly = () => {
    frame = 0;
    v = 0;
    until = null;
    const done = onRest;
    onRest = null;
    done?.();
    announceSettled();
  };

  const settle = () => {
    x = target;
    v = 0;
    frame = 0;
    write(x);
    const done = onRest;
    onRest = null;
    done?.();
    announceSettled();
  };

  const tick = (now) => {
    let remaining = last ? Math.min((now - last) / 1000, 0.064) : 1 / 60;
    last = now;
    while (remaining > 1e-6) {
      const h = Math.min(STEP, remaining);
      v += (-k * (x - target) - c * v) * h;
      x += v * h;
      remaining -= h;
    }
    if (Math.abs(x - target) < restDelta && Math.abs(v) < restDelta * 10) {
      settle();
      return;
    }
    write(x);
    if (until?.(x)) { finishEarly(); return; }
    frame = raf(tick);
  };

  return {
    value: () => x,
    velocity: () => v,
    isMoving: () => frame !== 0,
    /** Position set directly by the finger (track phase). Stops any spring. */
    set(next) {
      this.stop();
      x = next;
      v = 0;
      write(x);
    },
    /**
     * Spring to `to`, starting at `velocity` (units per second; defaults to
     * the current speed, so a retarget mid-flight is seamless).
     */
    to(to, { velocity = v, instant = false, done, until: stopWhen, stiffness: s, dampingRatio: d } = {}) {
      target = to;
      v = velocity;
      onRest = done ?? null;
      until = stopWhen ?? null;
      const ks = s ?? stiffness;
      k = ks;
      c = 2 * (d ?? dampingRatio) * Math.sqrt(ks);
      if (instant || !raf) {
        if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        settle();
        return;
      }
      if (!frame) {
        last = 0;
        frame = raf(tick);
      }
    },
    stop() {
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = 0;
      onRest = null;
      until = null;
    },
  };
}

/**
 * Resistance past an edge: the element keeps moving, by less and less, so it
 * feels like stretching rather than hitting a wall. `limit` is the most it can
 * ever travel past the edge.
 */
export function rubberBand(overshoot, limit) {
  if (overshoot <= 0) return 0;
  return limit * (1 - Math.exp(-overshoot / limit));
}

/** Release velocity (units/s) from recent samples, over the last `windowMs`. */
export function releaseVelocity(samples, windowMs = 100) {
  if (samples.length < 2) return 0;
  const end = samples[samples.length - 1];
  let start = samples[0];
  for (const s of samples) {
    if (end.t - s.t <= windowMs) { start = s; break; }
  }
  const dt = end.t - start.t;
  return dt > 0 ? ((end.x - start.x) / dt) * 1000 : 0;
}
