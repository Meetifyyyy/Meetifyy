import { useRef } from 'react';

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Accept-window countdown.
 *
 * Turns coral under ten seconds. The number is the accessible value; the ring
 * is decoration, so the whole thing is exposed as one timer rather than as a
 * graphic plus a stray digit.
 *
 * ── Why the ring is not driven by `timeLeft` ──────────────────────────────
 *
 * It used to set `strokeDashoffset` from the prop, so a smooth arc required the
 * timer to tick four times a second, and every one of those ticks re-rendered
 * the match popup around it.
 *
 * The arc is now a CSS animation over the whole window, offset by however much
 * of that window had already elapsed when this mounted. The browser interpolates
 * it at display rate — smoother than 4 fps ever was — while React only re-renders
 * for the digits, once a second. The animation values are computed once and held
 * in a ref, so a re-render rewrites identical style properties and the animation
 * is never restarted mid-countdown.
 */
export default function CountdownRing({ timeLeft, total }) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 30;
  const urgent = timeLeft <= 10;

  // Fixed at mount: how far into the window we already are. A match restored
  // mid-countdown therefore picks the arc up where it actually stands rather
  // than restarting it full.
  const arcRef = useRef(null);
  if (arcRef.current === null) {
    const remaining = Math.max(0, Math.min(safeTotal, Number(timeLeft) || 0));
    arcRef.current = {
      animationDuration: `${safeTotal}s`,
      animationDelay: `${-(safeTotal - remaining)}s`,
    };
  }

  return (
    <div
      className={`im-ring ${urgent ? 'is-urgent' : ''}`}
      role="timer"
      aria-label={`${timeLeft} seconds left to respond`}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="im-ring-track" cx="32" cy="32" r={RADIUS} />
        <circle
          className="im-ring-progress"
          cx="32" cy="32" r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          style={arcRef.current}
        />
      </svg>
      <span className="im-ring-value" aria-hidden="true">{timeLeft}</span>
    </div>
  );
}
