import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useInstantMatch } from '../context/InstantMatchContext';
import { MatchMark } from './decor/Decor';
import { ChatIcon } from './art/icons';
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
  // Shown while the boot read is still in flight. It has its own row rather
  // than falling back to `idle` because "we do not know yet" and "you are not
  // matched" are different facts, and rendering the second one for the first
  // is exactly the bug this state exists to prevent.
  initializing: {
    tag: '',
    label: 'Instant Match is loading',
    announce: '',
  },
  idle: {
    tag: 'Match',
    label: 'Open Instant Match',
    announce: '',
  },
  searching: {
    tag: 'Searching',
    label: 'Open Instant Match, still searching',
    announce: 'Instant Match is searching for a partner.',
  },
  reconnecting: {
    tag: 'Reconnecting',
    label: 'Open Instant Match, reconnecting',
    announce: 'Reconnecting. Your Instant Match search is still running.',
  },
  matched: {
    tag: 'Matched',
    label: 'Open your Instant Match chat',
    announce: 'You have a match. Your chat is open for 24 hours.',
  },
  ended: {
    tag: 'Ended',
    label: 'Open your ended Instant Match',
    announce: 'Your Instant Match has ended.',
  },
  error: {
    tag: 'Retry',
    label: 'Instant Match had a problem. Tap to try again',
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
  const startedAt = countdown?.startedAt;
  const expiresAt = countdown?.expiresAt;
  const [remaining, setRemaining] = useState(() => progressOf(startedAt, expiresAt));

  useEffect(() => {
    if (!startedAt || !expiresAt) {
      setRemaining(0);
      return undefined;
    }
    setRemaining(progressOf(startedAt, expiresAt));
    const id = window.setInterval(() => {
      setRemaining(progressOf(startedAt, expiresAt));
    }, 30_000);
    return () => window.clearInterval(id);
  }, [startedAt, expiresAt]);

  return remaining;
}

function progressOf(startedAt, expiresAt) {
  if (!startedAt || !expiresAt) return 0;
  const total = expiresAt - startedAt;
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, (expiresAt - Date.now()) / total));
}

export default function InstantMatchFAB() {
  const {
    sheetOpen, buttonState, openSheet, matchCountdown, isVerified,
    unreadCount,
  } = useInstantMatch();
  const location = useLocation();

  // Bail-out deliberately deferred: useCountdownProgress runs below, and
  // returning here changed the hook count between renders. The countdown is
  // fed null while unverified, so it stays inert either way.
  const state = STATE_CONFIG[buttonState] ? buttonState : 'idle';
  const config = STATE_CONFIG[state];

  // A live match card owns the screen; the launcher stands down for it.
  const hidden =
    location.pathname !== '/home' || sheetOpen || buttonState === 'responding';

  const showHalo = state === 'searching' || state === 'reconnecting';
  // The badge belongs to the matched state and to nothing else: the count is
  // scoped to the live session, so an ended one cannot carry a badge here.
  const showUnread = state === 'matched' && unreadCount > 0;
  // The ring belongs to the matched state, where there is a real deadline to
  // show: the 24 hours the chat stays open. It closes on itself as that
  // window runs down.
  const showRing = state === 'matched' && Boolean(matchCountdown);
  const remaining = useCountdownProgress(
    isVerified && showRing ? matchCountdown : null,
  );

  // The pill peeks: it shows for a moment whenever the launcher comes back
  // on screen or changes state (sending a search to the background is both),
  // then tucks away. Hover and keyboard focus bring it back (the CSS).
  const peeking = usePeek(`${hidden}:${state}`, !hidden);

  if (!isVerified) return null;

  // A skeleton, deliberately non-interactive: tapping a launcher whose state
  // is still unknown would open the sheet on a guess.
  if (state === 'initializing') {
    return (
      <div
        className={`im-scope im-fab-dock ${hidden ? 'im-fab-dock-hidden' : ''}`}
        inert={hidden ? '' : undefined}
      >
        <span className="im-fab-wrap">
          <span
            className="im-fab im-fab-initializing"
            role="status"
            aria-label={config.label}
            aria-busy="true"
          >
            <span className="im-fab-face">
              <MatchMark className="im-fab-glyph" />
            </span>
          </span>
        </span>
      </div>
    );
  }

  // A state pill sits to the left of the button only when there is news to
  // read: idle and matched say it with the glyph (and the ring) alone.
  const showTag = state === 'searching' || state === 'reconnecting'
    || state === 'ended' || state === 'error';

  return (
    <div
      className={`im-scope im-fab-dock ${hidden ? 'im-fab-dock-hidden' : ''}`}
      /* `inert` keeps the hidden launcher out of the tab order entirely,
         rather than leaving an invisible focus stop behind. */
      inert={hidden ? '' : undefined}
    >
      {showTag && (
        <span
          className={`im-fab-pill im-fab-pill-${state} ${peeking ? 'is-peek' : ''}`}
          aria-hidden="true"
        >
          {state === 'searching' && <span className="im-live-dot" />}
          {config.tag}
        </span>
      )}

      <span className="im-fab-wrap">
        {/* Searching: a blue arc orbiting the button. One element rotated
            by transform, so it runs on the compositor. */}
        {showHalo && (
          <span
            className={`im-fab-orbit ${state === 'reconnecting' ? 'im-fab-orbit-slow' : ''}`}
            aria-hidden="true"
          />
        )}

        {showRing && (
          <CountdownRing remaining={remaining} />
        )}

        <button
          type="button"
          className={`im-fab im-fab-${state}`}
          onClick={openSheet}
          aria-label={config.label}
          data-state={state}
        >
          <span className="im-fab-face">
            {state === 'matched'
              ? <ChatIcon className="im-fab-glyph" />
              : <MatchMark className="im-fab-glyph" />}
          </span>
        </button>

        {/* New messages in the Instant Match chat: a red dot on the rim. The
            count is for screen readers (the live region below); visually a
            dot says "something new" without competing with the ring. */}
        {showUnread && <span className="im-fab-unread" aria-hidden="true" />}
      </span>

      {/* Politely announced so a screen-reader user learns what the launcher
          is doing without it stealing focus. */}
      <span className="im-sr-only" role="status" aria-live="polite">
        {showUnread
          ? `${unreadCount} new Instant Match message${unreadCount === 1 ? '' : 's'}.`
          : config.announce}
      </span>
    </div>
  );
}

/** How long the state pill stays out before it tucks away. */
const PEEK_MS = 1500;

/**
 * True for PEEK_MS after `key` changes while `active`, then false. One timer
 * per change; nothing ticks while the pill is simply sitting there.
 */
function usePeek(key, active) {
  const [peeking, setPeeking] = useState(active);

  useEffect(() => {
    if (!active) {
      setPeeking(false);
      return undefined;
    }
    setPeeking(true);
    const id = window.setTimeout(() => setPeeking(false), PEEK_MS);
    return () => window.clearTimeout(id);
  }, [key, active]);

  return peeking;
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
