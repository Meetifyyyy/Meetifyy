import { memo, useState, useEffect } from 'react';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { getActivityLabel, getTimePreference } from '../../constants/matchConstants';
import QueueMetrics from './QueueMetrics';
import SearchRadar from './SearchRadar';
import '../../styles/searching-screen.css';

const STATUS_LINES = [
  'Scanning your campus…',
  'Checking who is free…',
  'Lining up the best fit…',
  'Almost there…',
];

/** After this long, stop implying a match is imminent and say so plainly. */
const LONG_WAIT_MS = 120_000;

/*
 * ── Why the timers live in leaves ─────────────────────────────────────────
 *
 * A search runs for minutes. This screen used to own a 1 s elapsed counter and
 * a 3.2 s status rotation directly, so the whole subtree — the radar's entire
 * SVG included — reconciled once a second for the entire wait (measured: 6
 * re-renders in 6 s, unbounded).
 *
 * Each ticking value now sits in the smallest component that displays it, so a
 * tick re-renders a single text node. `SearchingScreen` itself now renders only
 * when something real changes, and `SearchRadar` is memoised on top of that, so
 * the animation is handed to the browser once and never touched again.
 */

/** The mm:ss readout. Owns its own clock; nothing else re-renders with it. */
const ElapsedReadout = memo(function ElapsedReadout() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  // Below ten seconds a timer reads as impatience rather than information.
  if (elapsed < 10) return null;

  return (
    <p className="im-metrics-elapsed">
      <span className="im-sr-only">Time spent searching: </span>
      {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
    </p>
  );
});

/** The rotating reassurance line. Also a live region, so it is announced. */
const StatusLine = memo(function StatusLine({ connected }) {
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (!connected) return undefined;
    const id = window.setInterval(
      () => setLine((i) => (i + 1) % STATUS_LINES.length),
      3200,
    );
    return () => window.clearInterval(id);
  }, [connected]);

  return (
    <p className="im-lede" role="status" aria-live="polite">
      {connected
        ? STATUS_LINES[line]
        : 'Reconnecting — your place in the queue is held.'}
    </p>
  );
});

/**
 * One state change, not a per-second comparison: a single timeout flips this
 * once, two minutes in.
 */
const LongWaitNotice = memo(function LongWaitNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), LONG_WAIT_MS);
    return () => window.clearTimeout(id);
  }, []);

  if (!show) return null;

  return (
    <p className="im-searching-patience" role="status">
      Quiet right now. We&apos;ll keep looking — you can close this and we&apos;ll
      buzz you the moment someone turns up.
    </p>
  );
});

/**
 * The waiting room.
 *
 * Two jobs: make an indefinite wait feel deliberate rather than broken, and
 * make it obvious the search survives minimising the sheet.
 */
export default function SearchingScreen() {
  const { cancelSearch, closeSheet, formData, busy, connected, status } = useInstantMatch();

  const activityLabel = getActivityLabel(formData.activity, 'a hangout');
  const when = getTimePreference(formData.timePreference);

  return (
    <div className="im-searching">
      <SearchRadar />

      <div className="im-searching-copy">
        <span className="im-sticker im-sticker-coral">Searching</span>
        <h3 className="im-display im-display-lg">
          Finding someone
          <br />
          for {activityLabel.toLowerCase()}
        </h3>
        <StatusLine connected={connected} />
        {when && (
          <p className="im-searching-when">
            <span aria-hidden="true">{when.emoji}</span> {when.title}
          </p>
        )}
      </div>

      <QueueMetrics>
        <ElapsedReadout />
      </QueueMetrics>

      <LongWaitNotice />

      <div className="im-searching-actions">
        <button
          type="button"
          className="im-btn im-btn-ghost im-btn-sm"
          onClick={closeSheet}
        >
          Keep searching in background
        </button>
        <button
          type="button"
          className="im-btn im-btn-sm im-searching-cancel"
          onClick={cancelSearch}
          disabled={busy || status !== 'searching'}
        >
          {busy ? 'Stopping…' : 'Cancel search'}
        </button>
      </div>
    </div>
  );
}
