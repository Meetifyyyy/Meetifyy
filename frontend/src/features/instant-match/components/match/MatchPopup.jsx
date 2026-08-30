import React, { useRef, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { useMatchTimer } from '../../hooks/useMatchTimer';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useAuth } from '@shared/context/AuthContext';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import { getActivity, getActivityVerb, getAreaLabel, accentVars } from '../../constants/matchConstants';
import { getAcceptTimer } from '../../utils/timerByActivity';
import CountdownRing from './CountdownRing';
import { Blob, Starburst, Halftone, Grain, Bolt, Squiggle } from '../decor/Decor';
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

  const areaLabel = getAreaLabel(area);
  const intent = `Wants to ${getActivityVerb(activity)}${areaLabel ? ` near ${areaLabel}` : ''}`;

  const candidateYear = candidate?.passingYear ?? candidate?.currentYear;
  const subline = [candidate?.course, candidate?.branch, yearLabel(candidateYear)]
    .filter(Boolean)
    .join(' · ');

  const accentStyle = accentVars(activityMeta, 'im-accent');

  const responding = status === 'match_found';

  return createPortal(
    <div className="im-scope im-match-overlay" style={accentStyle}>
      <div
        className={`im-match-card im-match-${status}`}
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {/* Layered poster ground */}
        <div className="im-match-ground" aria-hidden="true">
          <Halftone className="im-match-dots" id="im-dots-match" />
          <Blob className="im-match-blob-1" variant={1} />
          <Blob className="im-match-blob-2" variant={2} />
          <Starburst className="im-match-burst" points={16} />
          <Grain />
        </div>

        {status === 'matched' ? (
          <SuccessPanel name={candidate?.displayName} titleId={titleId} />
        ) : (
          <div className="im-match-content">
            <div className="im-match-topline">
              <span className="im-sticker im-sticker-lime">
                <Bolt /> Match found
              </span>
              {responding && (
                <CountdownRing timeLeft={timeLeft} total={fallbackSecs} />
              )}
            </div>

            <Avatar candidate={candidate} />

            <div className="im-match-identity">
              <h2 id={titleId} className="im-display im-display-xl im-match-name">
                {candidate?.displayName || candidate?.username || 'A student'}
              </h2>
              <Squiggle className="im-match-squiggle" />
              {subline && <p className="im-match-sub">{subline}</p>}
            </div>

            <p className="im-match-intent">
              <span className="im-match-intent-emoji im-emoji" aria-hidden="true">
                {activityMeta?.emoji ?? '⚡'}
              </span>
              {intent}
            </p>

            {sharedInterests.length > 0 && (
              <div className="im-match-shared">
                <span className="im-eyebrow">You both like</span>
                <ul className="im-match-tags">
                  {sharedInterests.slice(0, 4).map((interest) => (
                    <li key={interest} className="im-match-tag">{interest}</li>
                  ))}
                </ul>
              </div>
            )}

            <MatchFooter
              status={status}
              busy={busy}
              timeLeft={timeLeft}
              onRespond={respondToMatch}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function MatchFooter({ status, busy, timeLeft, onRespond }) {
  if (status === 'waiting') {
    return (
      <div className="im-match-waiting" role="status" aria-live="polite">
        <span className="im-match-waiting-dots" aria-hidden="true">
          <i /><i /><i />
        </span>
        <p className="im-match-waiting-text">
          You're in. Waiting for them to accept…
        </p>
      </div>
    );
  }

  if (status === 'timed_out') {
    return (
      <div className="im-match-timeout" role="status" aria-live="polite">
        <span className="im-sticker im-sticker-coral">Time's up</span>
        <p className="im-lede">
          Nobody answered in time. Putting you both back in the queue…
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="im-match-actions">
        <button
          type="button"
          className="im-btn im-btn-ghost"
          onClick={() => onRespond('decline')}
          disabled={busy}
        >
          Pass
        </button>
        <button
          type="button"
          className="im-btn im-btn-yes im-match-accept"
          onClick={() => onRespond('accept')}
          disabled={busy}
        >
          {busy ? 'Sending…' : "Let's go"}
          {!busy && <Bolt className="im-btn-bolt" />}
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

function SuccessPanel({ name, titleId }) {
  return (
    <div className="im-match-success">
      <span className="im-match-success-burst" aria-hidden="true">
        <Starburst points={18} />
      </span>
      <span className="im-match-success-emoji" aria-hidden="true">🎉</span>
      <h2 id={titleId} className="im-display im-display-xl">You're matched!</h2>
      <p className="im-lede" role="status" aria-live="polite">
        Opening your chat with {name || 'them'}…
      </p>
    </div>
  );
}

/**
 * The matched student's real photo.
 *
 * `candidate.avatar` is a storage object key, not a URL, so it has to go
 * through the app's shared resolver — rendering it directly (as this did
 * before) requested a path that does not exist and every match fell back to
 * a placeholder. When there genuinely is no photo we show their initial,
 * which reads better here than the generic silhouette.
 */
function Avatar({ candidate }) {
  const [failed, setFailed] = React.useState(false);

  const resolved = React.useMemo(
    () => getProcessedAvatarUrl(candidate?.avatar),
    [candidate?.avatar],
  );
  const hasPhoto = Boolean(resolved) && !resolved.includes('default_avatar');

  const initial = (candidate?.displayName || candidate?.username || '?')
    .trim().charAt(0).toUpperCase();

  return (
    <div className="im-match-avatar-frame">
      <span className="im-match-avatar-plate" aria-hidden="true" />
      {hasPhoto && !failed ? (
        <img
          className="im-match-avatar"
          src={resolved}
          alt=""
          loading="eager"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="im-match-avatar im-match-avatar-initial" aria-hidden="true">
          {initial}
        </span>
      )}
    </div>
  );
}

function yearLabel(year) {
  if (!Number.isFinite(year) || year <= 0) return null;
  return String(year);
}
