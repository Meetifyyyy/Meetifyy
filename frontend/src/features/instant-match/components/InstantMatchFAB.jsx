import React from 'react';
import { useLocation } from 'react-router-dom';
import { useInstantMatch } from '../context/InstantMatchContext';
import { Bolt } from './decor/Decor';
import '../styles/instant-match.css';
import '../styles/instant-match-fab.css';

/**
 * The Instant Match launcher.
 *
 * Doubles as the search's ambient status: while queued it keeps pulsing and
 * announces itself as "still searching", so a user who minimised the sheet can
 * always see that matching is running and get back to it in one tap.
 */
export default function InstantMatchFAB() {
  const { sheetOpen, status, openSheet, queueStats } = useInstantMatch();
  const location = useLocation();

  const searching = status === 'searching';
  // A live match owns the screen; the launcher stands down for it.
  const hidden =
    location.pathname !== '/home' ||
    sheetOpen ||
    status === 'match_found' ||
    status === 'waiting' ||
    status === 'timed_out' ||
    status === 'matched';

  const label = searching
    ? 'Still searching for a match — open Instant Match'
    : 'Open Instant Match';

  return (
    <div
      className={`im-scope im-fab-dock ${hidden ? 'im-fab-dock-hidden' : ''}`}
      /* `inert` keeps the hidden launcher out of the tab order entirely,
         rather than leaving an invisible focus stop behind. */
      inert={hidden ? '' : undefined}
    >
      <span className="im-fab-wrap">
        {/* Scanning halo — the sonar sweep, shrunk to the launcher. Sits
            behind the button in DOM order so the button's own surface masks
            all but the rim. */}
        {searching && <span className="im-fab-halo" aria-hidden="true" />}

        <button
          type="button"
          className={`im-fab ${searching ? 'im-fab-searching' : ''}`}
          onClick={openSheet}
          aria-label={label}
        >
          <span className="im-fab-face">
            <Bolt className="im-fab-bolt" />
          </span>
          <span className="im-fab-tag" aria-hidden="true">
            {searching ? 'Searching' : 'Match'}
          </span>
        </button>
      </span>

      {searching && queueStats.count > 1 && (
        <span className="im-fab-count" aria-hidden="true">
          {queueStats.count}
        </span>
      )}

      {/* Politely announced so a screen-reader user learns the search is
          running without the launcher stealing focus. */}
      <span className="im-sr-only" role="status" aria-live="polite">
        {searching ? 'Instant Match is searching for a partner.' : ''}
      </span>
    </div>
  );
}
