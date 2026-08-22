import React from 'react';

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Accept-window countdown.
 *
 * Turns coral under ten seconds. The number is the accessible value; the ring
 * is decoration, so the whole thing is exposed as one timer rather than as a
 * graphic plus a stray digit.
 */
export default function CountdownRing({ timeLeft, total }) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 30;
  const ratio = Math.max(0, Math.min(1, timeLeft / safeTotal));
  const urgent = timeLeft <= 10;

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
          strokeDashoffset={CIRCUMFERENCE - ratio * CIRCUMFERENCE}
        />
      </svg>
      <span className="im-ring-value" aria-hidden="true">{timeLeft}</span>
    </div>
  );
}
