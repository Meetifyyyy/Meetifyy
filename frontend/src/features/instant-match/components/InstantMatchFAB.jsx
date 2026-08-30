import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useInstantMatch } from '../context/InstantMatchContext';
import { Bolt } from './decor/Decor';
import '../styles/instant-match.css';
import '../styles/instant-match-fab.css';

/**
 * The Instant Match launcher.
 *
 * Doubles as the ambient status for the whole feature, so a user who
 * minimised the sheet can always see what the server thinks is happening.
 * Every visual here is driven by `buttonState`, which the provider derives
 * from the authoritative socket state in one place — the launcher never
 * infers anything for itself, which is what used to leave it showing a plain
 * "Match" button after a successful match, or a stale "Searching" after a
 * reconnect.
 */

/** One row per state: label, screen-reader text, and the modifier class. */
const STATE_CONFIG = {
  idle: {
    tag: 'Match',
    label: 'Open Instant Match',
    announce: '',
  },
  searching: {
    tag: 'Searching',
    label: 'Still searching for a match — open Instant Match',
    announce: 'Instant Match is searching for a partner.',
  },
  reconnecting: {
    tag: 'Reconnect',
    label: 'Reconnecting — your search is still running',
    announce: 'Reconnecting. Your Instant Match search is still running.',
  },
  matched: {
    tag: 'Matched',
    label: 'You have a match — open your chat',
    announce: 'You have a match. Your chat is open for 24 hours.',
  },
  ended: {
    tag: 'Ended',
    label: 'Your Instant Match has ended — see what happened',
    announce: 'Your Instant Match has ended.',
  },
  error: {
    tag: 'Retry',
    label: 'Instant Match hit a problem — tap to try again',
    announce: '',
  },
};

/** Ring geometry, in the SVG's own 100×100 user space. */
const RING_RADIUS = 46;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Fraction of the countdown still remaining, 1 → 0.
 *
 * Repainted every 30 seconds rather than every frame: the arc moves about a
 * quarter of a degree per tick over a 24-hour window, so anything faster is
 * work nobody can see. CSS transitions the gap between ticks so the strip
 * still closes smoothly rather than stepping.
 */
function useCountdownProgress(countdown) {
  const [remaining, setRemaining] = useState(() => progressOf(countdown));

  useEffect(() => {
    if (!countdown) {
      setRemaining(0);
      return undefined;
    }
    setRemaining(progressOf(countdown));
    const id = window.setInterval(() => {
      setRemaining(progressOf(countdown));
    }, 30_000);
    return () => window.clearInterval(id);
  }, [countdown?.startedAt, countdown?.expiresAt]);

  return remaining;
}

function progressOf(countdown) {
  if (!countdown) return 0;
  const { startedAt, expiresAt } = countdown;
  const total = expiresAt - startedAt;
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, (expiresAt - Date.now()) / total));
}

export default function InstantMatchFAB() {
  const {
    sheetOpen, buttonState, openSheet, queueStats, matchCountdown, isVerified,
  } = useInstantMatch();
  const location = useLocation();

  if (!isVerified) return null;

  const state = STATE_CONFIG[buttonState] ? buttonState : 'idle';
  const config = STATE_CONFIG[state];

  // A live match card owns the screen; the launcher stands down for it.
  const hidden =
    location.pathname !== '/home' || sheetOpen || buttonState === 'responding';

  const showHalo = state === 'searching' || state === 'reconnecting';
  // The ring belongs to the matched state, where there is a real deadline to
  // show: the 24 hours the chat stays open. It closes on itself as that
  // window runs down.
  const showRing = state === 'matched' && Boolean(matchCountdown);
  const remaining = useCountdownProgress(showRing ? matchCountdown : null);
  // Matched drops the label entirely — the glyph plus the ring say it, and
  // the word competed with both.
  const showTag = state !== 'matched';

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
        {showHalo && (
          <span
            className={`im-fab-halo ${state === 'reconnecting' ? 'im-fab-halo-idlewait' : ''}`}
            aria-hidden="true"
          />
        )}

        {showRing && (
          <CountdownRing remaining={remaining} />
        )}

        <button
          type="button"
          className={`im-fab im-fab-${state} ${showTag ? '' : 'im-fab-bare'}`}
          onClick={openSheet}
          aria-label={config.label}
          data-state={state}
        >
          {/* The inner face is a separate, untransformed element. The
              launcher's playful tilt lives on the outer wrapper only, so no
              transform is ever inherited by the text or the icon — that
              inheritance was what made both look skewed. */}
          <span className="im-fab-face">
            {state === 'matched' || state === 'ended'
              ? <MatchedGlyph />
              : <Bolt className="im-fab-bolt" />}
          </span>
          {showTag && (
            <span className="im-fab-tag" aria-hidden="true">{config.tag}</span>
          )}
        </button>
      </span>

      {/* Everyone on Instant Match right now, this user included — the same
          global figure the searching screen leads with. */}
      {state === 'searching' && queueStats.count > 1 && (
        <span className="im-fab-count" aria-hidden="true">
          {queueStats.count}
        </span>
      )}

      {/* Politely announced so a screen-reader user learns what the launcher
          is doing without it stealing focus. */}
      <span className="im-sr-only" role="status" aria-live="polite">
        {config.announce}
      </span>
    </div>
  );
}

/**
 * The depleting strip around the launcher.
 *
 * Two stacked circles: a constant track and an arc whose dash offset grows as
 * the time runs out, so the strip visibly closes in on itself. Rotated -90deg
 * so it starts at twelve o'clock, and `aria-hidden` because the button's own
 * label already carries the meaning.
 */
function CountdownRing({ remaining }) {
  return (
    <svg className="im-fab-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="im-fab-ring-track" cx="50" cy="50" r={RING_RADIUS} />
      <circle
        className="im-fab-ring-arc"
        cx="50"
        cy="50"
        r={RING_RADIUS}
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - remaining)}
      />
    </svg>
  );
}

/** Two chat bubbles struck together — reads as "you have someone" at 26px,
 *  where a second bolt would just look like the idle state. */
function MatchedGlyph() {
  return (
    <svg
      className="im-fab-bolt"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-4.6A7.5 7.5 0 1 1 20 11.5Z" />
      <path d="M12.4 7.6 10.4 11h3.2l-2 3.4" />
    </svg>
  );
}
