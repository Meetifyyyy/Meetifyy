import { useRef } from 'react';

/**
 * Accept-window countdown: a bar along the card's top edge that empties, and
 * the seconds beside the title.
 *
 * The bar is one CSS animation over the whole window (scaleX, composited),
 * offset by however much of the window had already elapsed when it mounted,
 * so a match restored mid-countdown picks up where it actually stands. React
 * only re-renders for the digits, once a second; the animation values are
 * fixed in a ref so a re-render never restarts it.
 */
export function CountdownBar({ timeLeft, total, running = true }) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 30;
  const urgent = timeLeft <= 10;

  const arcRef = useRef(null);
  if (arcRef.current === null) {
    const remaining = Math.max(0, Math.min(safeTotal, Number(timeLeft) || 0));
    arcRef.current = {
      animationDuration: `${safeTotal}s`,
      animationDelay: `${-(safeTotal - remaining)}s`,
    };
  }

  return (
    <span
      className={`im-countdown-bar ${urgent ? 'is-urgent' : ''} ${running ? '' : 'is-held'}`}
      aria-hidden="true"
    >
      <span className="im-countdown-fill" style={arcRef.current} />
    </span>
  );
}

export function CountdownPill({ timeLeft }) {
  const urgent = timeLeft <= 10;
  return (
    <span
      className={`im-countdown-pill ${urgent ? 'is-urgent' : ''}`}
      role="timer"
      aria-label={`${timeLeft} seconds left to respond`}
    >
      <span aria-hidden="true">{timeLeft}s</span>
    </span>
  );
}

/**
 * The accept window as a ring around the other person's photo, emptying
 * clockwise. Same timing contract as the bar: one CSS animation over the
 * whole window, offset by what had already elapsed at mount, held in a ref
 * so a re-render never restarts it.
 */
export function CountdownHalo({ timeLeft, total, running = true, size = 128 }) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 30;
  const urgent = timeLeft <= 10;

  const arcRef = useRef(null);
  if (arcRef.current === null) {
    const remaining = Math.max(0, Math.min(safeTotal, Number(timeLeft) || 0));
    arcRef.current = {
      animationDuration: `${safeTotal}s`,
      animationDelay: `${-(safeTotal - remaining)}s`,
    };
  }

  return (
    <svg
      className={`im-halo ${urgent ? 'is-urgent' : ''} ${running ? '' : 'is-held'}`}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle className="im-halo-track" cx="50" cy="50" r="46" />
      <circle className="im-halo-arc" cx="50" cy="50" r="46" pathLength="1" style={arcRef.current} />
    </svg>
  );
}
