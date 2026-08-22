import React, { useState, useEffect } from 'react';
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

/**
 * The waiting room.
 *
 * Two jobs: make an indefinite wait feel deliberate rather than broken, and
 * make it obvious the search survives minimising the sheet.
 */
export default function SearchingScreen() {
  const { cancelSearch, closeSheet, formData, busy, connected, status } = useInstantMatch();
  const [line, setLine] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setLine((i) => (i + 1) % STATUS_LINES.length), 3200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activityLabel = getActivityLabel(formData.activity, 'a hangout');
  const when = getTimePreference(formData.timePreference);

  // After a couple of minutes, stop pretending it is imminent and say so.
  const longWait = elapsed > 120;

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
        <p className="im-lede" role="status" aria-live="polite">
          {connected ? STATUS_LINES[line] : 'Reconnecting — your place in the queue is held.'}
        </p>
        {when && (
          <p className="im-searching-when">
            <span aria-hidden="true">{when.emoji}</span> {when.title}
          </p>
        )}
      </div>

      <QueueMetrics elapsed={elapsed} />

      {longWait && (
        <p className="im-searching-patience">
          Quiet right now. We'll keep looking — you can close this and we'll
          buzz you the moment someone turns up.
        </p>
      )}

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
