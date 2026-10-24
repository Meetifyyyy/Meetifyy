import { useRef, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { useMatchTimer } from '../../hooks/useMatchTimer';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useAuth } from '@shared/context/AuthContext';
import {
  getActivity, getActivityVerb, getAreaLabel, accentVars,
} from '../../constants/matchConstants';
import { getAcceptTimer } from '../../utils/timerByActivity';
import { MeetScene } from '../art/CampusMap';
import {
  ActivityIcon, AreaIcon, CheckIcon, CloseIcon, SpinnerIcon,
} from '../art/icons';
import { MatchMark } from '../decor/Decor';
import Face, { firstName } from '../art/Face';
import { CountdownHalo, CountdownPill } from './Countdown';
import '../../styles/instant-match.css';
import '../../styles/match-popup.css';

const LIVE_STATUSES = new Set(['match_found', 'waiting', 'timed_out', 'matched']);

/**
 * The match card.
 *
 * Rendered as a wrapper that never returns early before its hooks, so the
 * component's hook order is identical on every render — the previous version
 * bailed out above `useMatchTimer`, which crashed React the moment a match
 * actually arrived.
 */
export default function MatchPopup() {
  const { status, activeMatch, isVerified } = useInstantMatch();

  if (!isVerified || !LIVE_STATUSES.has(status) || !activeMatch) return null;
  // Keyed by match id so a second match mounts a genuinely fresh card
  // (and a fresh countdown) rather than reusing the previous one's state.
  return <MatchCard key={activeMatch.matchId} />;
}

function MatchCard() {
  const { status, activeMatch, respondToMatch, handleMatchTimeout, busy } = useInstantMatch();
  const { currentUser } = useAuth();

  const cardRef = useRef(null);
  const titleId = useId();

  const { candidate, activity, area, timer, expiresAt } = activeMatch;
  const activityMeta = getActivity(activity);

  const fallbackSecs = timer || getAcceptTimer(activity, null);
  const { timeLeft } = useMatchTimer(expiresAt, fallbackSecs, handleMatchTimeout);

  useScrollLock(true);
  // No Escape handler: a live match is a decision, not something to dismiss.
  useFocusTrap(cardRef, true, undefined);

  const sharedInterests = useMemo(() => {
    const mine = currentUser?.interests;
    const theirs = candidate?.interests;
    if (!Array.isArray(mine) || !Array.isArray(theirs)) return [];
    const mineLower = new Set(mine.map((i) => String(i).toLowerCase()));
    return theirs.filter((i) => mineLower.has(String(i).toLowerCase()));
  }, [currentUser?.interests, candidate?.interests]);

  const name = candidate?.displayName || candidate?.username || 'A student';
  const areaLabel = getAreaLabel(area);

  const candidateYear = candidate?.passingYear ?? candidate?.currentYear;
  const subline = [candidate?.course, candidate?.branch, yearLabel(candidateYear)]
    .filter(Boolean)
    .join(' · ');

  const responding = status === 'match_found';
  const success = status === 'matched';

  return createPortal(
    <div className="im-scope im-match-overlay" style={accentVars(activityMeta)}>
      <div
        className={`im-match-card im-match-${status}`}
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="im-match-hero">
          {/* Straddles the map's top edge: half on the card, half on the art. */}
          {!success && (
            <span className="im-match-tag">
              <MatchMark />
              {activeMatch.awaitingOther
                ? 'Request sent'
                : activeMatch.requested ? 'Match request' : 'Match found'}
            </span>
          )}
          <MeetScene variant="match" className="im-match-scene">
            {success ? (
              <span className="im-pair im-pair-joined">
                <Face
                  className="im-pair-face im-pair-you"
                  avatar={currentUser?.avatar || currentUser?.avatarUrl}
                  name={currentUser?.displayName || currentUser?.username || 'You'}
                  size={84}
                />
                <span className="im-pair-node"><MatchMark /></span>
                <Face className="im-pair-face im-pair-them" avatar={candidate?.avatar} name={name} size={84} />
              </span>
            ) : (
              <span className="im-match-portrait">
                <CountdownHalo
                  timeLeft={timeLeft}
                  total={fallbackSecs}
                  // A request we sent is still their decision against the
                  // clock, so the ring keeps running while we wait.
                  running={responding || Boolean(activeMatch.awaitingOther)}
                  size={136}
                />
                <Face avatar={candidate?.avatar} name={name} size={108} />
                <span className="im-match-badge im-icon-tile" aria-hidden="true">
                  <ActivityIcon id={activity} />
                </span>
              </span>
            )}
          </MeetScene>
        </div>

        {success ? (
          <div className="im-match-body im-match-success">
            <span className="im-eyebrow im-eyebrow-blue">It&apos;s a match</span>
            <h2 id={titleId} className="im-title im-title-lg">You&apos;re matched</h2>
            <p className="im-lede" role="status" aria-live="polite">
              Opening your chat with {firstName(name) || 'them'}…
            </p>
          </div>
        ) : (
          <div className="im-match-body">
            <div className="im-match-identity">
              <div className="im-match-nameline">
                <h2 id={titleId} className="im-title im-title-lg">{name}</h2>
                {responding && <CountdownPill timeLeft={timeLeft} />}
              </div>
              {subline && <p className="im-match-sub">{subline}</p>}
            </div>

            <div className="im-match-intent">
              <span className="im-icon-tile" aria-hidden="true">
                <ActivityIcon id={activity} />
              </span>
              <span className="im-match-intent-text">
                <span className="im-match-intent-title">
                  Wants to {getActivityVerb(activity)}
                </span>
                <span className="im-match-intent-where">
                  {areaLabel ? (
                    <>
                      <AreaIcon id={area} />
                      Near {areaLabel}
                    </>
                  ) : 'Anywhere on campus'}
                </span>
              </span>
            </div>

            {sharedInterests.length > 0 && (
              <div className="im-match-shared">
                <span className="im-eyebrow">You both like</span>
                <ul className="im-match-tags">
                  {sharedInterests.slice(0, 4).map((interest) => (
                    <li key={interest} className="im-chip">{interest}</li>
                  ))}
                </ul>
              </div>
            )}

            <MatchFooter
              status={status}
              busy={busy}
              timeLeft={timeLeft}
              requestSent={Boolean(activeMatch.awaitingOther)}
              name={firstName(name) || 'them'}
              onRespond={respondToMatch}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function MatchFooter({ status, busy, timeLeft, name, requestSent, onRespond }) {
  if (status === 'waiting') {
    return (
      <>
      <div className="im-match-wait" role="status" aria-live="polite">
        <span className="im-match-wait-icon" aria-hidden="true"><CheckIcon /></span>
        <span className="im-match-wait-text">
          <span className="im-match-wait-title">
            {requestSent ? 'Request sent' : <>You&apos;re in</>}
          </span>
          <span className="im-match-wait-sub">Waiting for {name} to accept</span>
        </span>
        <SpinnerIcon className="im-match-wait-spinner" />
      </div>
      {requestSent && (
        <button
          type="button"
          className="im-btn im-btn-ghost im-match-withdraw"
          onClick={() => onRespond('decline')}
          disabled={busy}
        >
          {busy ? 'Withdrawing…' : 'Withdraw request'}
        </button>
      )}
      </>
    );
  }

  if (status === 'timed_out') {
    return (
      <div className="im-match-wait im-match-timeout" role="status" aria-live="polite">
        <span className="im-match-wait-text">
          <span className="im-match-wait-title">Time&apos;s up</span>
          <span className="im-match-wait-sub">
            Nobody answered in time. Putting you both back in the queue…
          </span>
        </span>
        <SpinnerIcon className="im-match-wait-spinner" />
      </div>
    );
  }

  return (
    <>
      <div className="im-match-actions">
        <button
          type="button"
          className="im-btn"
          onClick={() => onRespond('decline')}
          disabled={busy}
        >
          <CloseIcon />
          Pass
        </button>
        <button
          type="button"
          className="im-btn im-btn-primary im-match-accept"
          onClick={() => onRespond('accept')}
          disabled={busy}
        >
          {!busy && <CheckIcon />}
          {busy ? 'Sending…' : 'Accept'}
        </button>
      </div>
      {/* Read out at coarse intervals only — a per-second live region would
          make a screen reader unusable for the whole countdown. */}
      <span className="im-sr-only" role="status" aria-live="polite">
        {timeLeft === 30 || timeLeft === 10 || timeLeft === 5
          ? `${timeLeft} seconds left to respond`
          : ''}
      </span>
    </>
  );
}

function yearLabel(year) {
  if (!Number.isFinite(year) || year <= 0) return null;
  return String(year);
}
