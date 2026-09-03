import { useInstantMatch, useInstantMatchQueueStats } from '../../context/InstantMatchContext';
import { getActivityLabel } from '../../constants/matchConstants';

function formatWait(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return null;
  if (secs < 90) return `${Math.max(15, Math.round(secs / 15) * 15)}s`;
  return `${Math.round(secs / 60)} min`;
}

/**
 * Live Instant Match activity.
 *
 * The headline figure is everyone searching right now, across every activity
 * — not just the tile this user picked. The old per-bucket count reported
 * "0 others" while plenty of people were searching one tile over, which made
 * the whole feature look dead. The line underneath keeps the number that
 * actually governs *this* search: how many share the activity, which is the
 * one requirement matching will not compromise on.
 *
 * The server pushes a fresh count whenever anyone joins, cancels, matches or
 * expires, so these are real numbers rather than decorative ones.
 */
export default function QueueMetrics({ children }) {
  const queueStats = useInstantMatchQueueStats();
  const { formData } = useInstantMatch();

  const count = Number(queueStats?.count) || 0;
  const sameActivity = Number(queueStats?.sameActivity) || 0;
  // Both counts include this user, so "others" is what actually matters.
  const others = Math.max(0, count - 1);
  const othersHere = Math.max(0, sameActivity - 1);
  const activityLabel = getActivityLabel(formData.activity, 'this').toLowerCase();
  const wait = formatWait(queueStats?.avgWaitSecs);

  return (
    <div className="im-metrics">
      <div className="im-metrics-row">
        <span className="im-metrics-figure">{others}</span>
        <span className="im-metrics-caption">
          {others === 0
            ? 'first in line on Instant Match'
            : others === 1
              ? 'other student searching right now'
              : 'others searching right now'}
        </span>
      </div>

      <hr className="im-rule im-metrics-rule" />

      <p className="im-metrics-note">
        {others === 0
          ? "We'll pair you the moment someone joins."
          : othersHere === 0
            ? `You're first for ${activityLabel}.`
            : othersHere === 1
              ? `1 of them is up for ${activityLabel}.`
              : `${othersHere} of them are up for ${activityLabel}.`}
      </p>

      {others > 0 && wait && (
        <p className="im-metrics-note">Typical wait: about {wait}.</p>
      )}

      {/* The elapsed readout is passed in rather than computed here: it ticks
          every second, and owning it would drag these live counts — and the
          radar beside them — into a re-render once a second for the whole
          search. As a child it re-renders alone. */}
      {children}
    </div>
  );
}
