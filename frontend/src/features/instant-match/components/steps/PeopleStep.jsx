import React, { useMemo, useState } from 'react';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import emptyMascotImg from '@assets/images/instant_match_mascot.webp';
import {
  getActivity, getAreaLabel, getTimePreference, accentVars,
} from '../../constants/matchConstants';
import { Ticks } from '../decor/Decor';

/**
 * Who is searching right now — the screen Instant Match opens on.
 *
 * Every line here is a column of that person's own queue entry: the activity
 * they picked, when they want to meet, the area they typed in and the one-line
 * detail, all of it exactly as the matcher reads it. Nothing is derived and
 * nothing is filled in — a person who gave no area simply has no area line, so
 * the list can never claim more than someone actually said.
 *
 * The rows are deliberately not interactive. Instant Match pairs people
 * through the queue, not by picking a face out of a list, and a tappable row
 * would promise something the feature does not do.
 *
 * Presentational: the roster is read by the sheet, which needs to know whether
 * there is anything to list before it decides to draw its own heading.
 */
export default function PeopleStep({ people, loading, error, retry }) {
  if (loading) return <RosterLoader />;
  if (error) return <RosterError message={error} onRetry={retry} />;
  if (!people.length) return <EmptyQueue />;

  return (
    <ul className="im-people" aria-label="People searching on Instant Match">
      {people.map((person, i) => (
        <PersonRow key={person.user.id} person={person} index={i} />
      ))}
    </ul>
  );
}

/** One spinner, centred. A skeleton promised a list before we knew there was
 *  one to show — and on an empty queue it was a lie the next frame corrected. */
function RosterLoader() {
  return (
    <div className="im-people-loader" role="status">
      <svg
        className="im-people-spinner"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" strokeOpacity="0.22" />
        <path d="M12 3a9 9 0 0 1 9 9" />
      </svg>
      <span className="im-sr-only">Loading who is searching</span>
    </div>
  );
}

function RosterError({ message, onRetry }) {
  return (
    <div className="im-people-state" role="alert">
      <span className="im-sticker im-sticker-coral">Couldn&apos;t load</span>
      <p className="im-lede">{message}</p>
      <button type="button" className="im-btn im-btn-ghost im-btn-sm" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/**
 * Nobody is waiting.
 *
 * Carried entirely by the friendly mascot illustration (which incorporates the
 * "nobody yet?" lettering). Screen reader text is retained for accessibility.
 */
function EmptyQueue() {
  return (
    <div className="im-people-empty" role="status">
      <img
        src={emptyMascotImg}
        alt="Nobody yet?"
        className="im-people-empty-mascot"
        width={1671}
        height={941}
      />
      <span className="im-sr-only">Nobody yet</span>
      <span className="im-sr-only">Be the first.</span>
    </div>
  );
}

function PersonRow({ person, index }) {
  const activity = getActivity(person.activity);
  const when = getTimePreference(person.timePreference);
  const areaLabel = getAreaLabel(person.area);
  const name = person.user.displayName || person.user.username || 'A student';
  const waited = waitedFor(person.joinedAt);

  return (
    <li className="im-person" style={accentVars(activity)}>
      {/* Same rhythm as the activity grid: a mark every third row, so the
          list has texture without decorating every line. */}
      {index % 3 === 1 && <Ticks className="im-person-ticks" />}

      <Portrait person={person.user} name={name} />

      <div className="im-person-text">
        <p className="im-person-head">
          <span className="im-person-name">{name}</span>
          {when && (
            <span className="im-person-when">
              <span className="im-emoji" aria-hidden="true">{when.emoji}</span>
              {when.title}
            </span>
          )}
        </p>

        <p className="im-person-activity">
          <span className="im-person-emoji im-emoji" aria-hidden="true">
            {activity?.emoji ?? '⚡'}
          </span>
          <span className="im-person-label">{activity?.label ?? person.activity}</span>
          {person.optionalDetail && (
            <span className="im-person-detail">{person.optionalDetail}</span>
          )}
        </p>

        {/* Only rendered when there is something to say: an area nobody gave
            is an absent line, never an "unknown" placeholder. */}
        {(areaLabel || waited) && (
          <p className="im-person-meta">
            {areaLabel && (
              <span className="im-person-area">
                <span aria-hidden="true">📍</span> {areaLabel}
              </span>
            )}
            {waited && <span className="im-person-wait">{waited}</span>}
          </p>
        )}
      </div>
    </li>
  );
}

/** How long they have been waiting, from the queue row's own `joinedAt`.
 *  Coarse on purpose: this refreshes when the queue moves, not every second,
 *  and a minute figure stays true for a minute. */
function waitedFor(joinedAt) {
  if (!Number.isFinite(joinedAt)) return null;
  const mins = Math.floor((Date.now() - joinedAt) / 60000);
  if (mins < 1) return 'just joined';
  return `waiting ${mins}m`;
}

/**
 * Their photo. `avatar` is a storage object key rather than a URL, so it goes
 * through the app's shared resolver — the same path the match card uses — and
 * falls back to the initial rather than a generic silhouette.
 */
function Portrait({ person, name }) {
  const [failed, setFailed] = useState(false);

  const resolved = useMemo(
    () => getProcessedAvatarUrl(person.avatar),
    [person.avatar],
  );
  const hasPhoto = Boolean(resolved) && !resolved.includes('default_avatar');

  if (hasPhoto && !failed) {
    return (
      <img
        className="im-person-face"
        src={resolved}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="im-person-face im-person-face-initial" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
