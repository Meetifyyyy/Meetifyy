import React from 'react';
import { Bolt } from '../decor/Decor';

/**
 * The searching loop — a campus sonar.
 *
 * Everything here runs on one continuous cycle rather than a restarting
 * pulse: a beam sweeps the field, dotted rings counter-rotate under it, and
 * three "student" markers orbit at different radii and speeds, brightening as
 * the beam passes them. Nothing snaps back to a start frame, so a long wait
 * never looks like a stuck spinner.
 *
 * Purely decorative — the searching status is announced in text alongside it.
 */
export default function SearchRadar() {
  return (
    <div className="im-radar" aria-hidden="true">
      <span className="im-radar-field" />
      <span className="im-radar-sweep" />

      <svg className="im-radar-rings" viewBox="0 0 120 120" focusable="false">
        <circle className="im-radar-ring im-radar-ring-1" cx="60" cy="60" r="54" />
        <circle className="im-radar-ring im-radar-ring-2" cx="60" cy="60" r="40" />
        <circle className="im-radar-ring im-radar-ring-3" cx="60" cy="60" r="26" />
      </svg>

      {/* Each orbit is a rotating frame with a marker pinned to its edge. */}
      <span className="im-radar-orbit im-radar-orbit-1"><i /></span>
      <span className="im-radar-orbit im-radar-orbit-2"><i /></span>
      <span className="im-radar-orbit im-radar-orbit-3"><i /></span>

      <span className="im-radar-core">
        <Bolt className="im-radar-bolt" />
      </span>
    </div>
  );
}
