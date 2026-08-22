import React from 'react';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { getActivityLabel } from '../../constants/matchConstants';

function formatWait(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return null;
  if (secs < 90) return `${Math.max(15, Math.round(secs / 15) * 15)}s`;
  return `${Math.round(secs / 60)} min`;
}

/**
 * Live queue depth for the bucket the user is waiting in.
 *
 * The server pushes a fresh count whenever anyone joins, cancels, matches or
 * expires, so this is a real number rather than a decorative one — which is
 * why the empty case says something honest instead of inventing a statistic.
 */
export default function QueueMetrics({ elapsed = 0 }) {
  const { queueStats, formData } = useInstantMatch();

  const count = Number(queueStats?.count) || 0;
  // The count includes this user, so "others" is what actually matters.
  const others = Math.max(0, count - 1);
  const activityLabel = getActivityLabel(formData.activity, 'this');
  const wait = formatWait(queueStats?.avgWaitSecs);

  return (
    <div className="im-metrics">
      <div className="im-metrics-row">
        <span className="im-metrics-figure">{others}</span>
        <span className="im-metrics-caption">
          {others === 0
            ? `first in line for ${activityLabel.toLowerCase()}`
            : others === 1
              ? `other student searching for ${activityLabel.toLowerCase()}`
              : `others searching for ${activityLabel.toLowerCase()}`}
        </span>
      </div>

      <hr className="im-rule im-metrics-rule" />

      <p className="im-metrics-note">
        {others === 0
          ? "You're at the front — we'll pair you the second someone joins."
          : wait
            ? `Typical wait here: about ${wait}.`
            : 'Pairing you as soon as the best fit appears.'}
      </p>

      {elapsed >= 10 && (
        <p className="im-metrics-elapsed">
          <span className="im-sr-only">Time spent searching: </span>
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
        </p>
      )}
    </div>
  );
}
