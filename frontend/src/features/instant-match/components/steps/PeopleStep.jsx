import React, { useMemo, useState } from 'react';
import { getProcessedAvatarUrl } from '@shared/components/avatar/Avatar';
import {
  getActivity, getAreaLabel, getTimePreference, accentVars,
} from '../../constants/matchConstants';
import { Blob, Bolt, Halftone, Squiggle, Ticks } from '../decor/Decor';

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
 * The whole screen, carried by one mark and two lines of type — the sheet
 * drops its own heading for this state, because a title that announces a list
 * above an empty one is the noise, not the information.
 *
 * The mark is a flat, still illustration in the feature's own printing idiom:
 * a paper window, two spot-colour plates laid slightly off register so they
 * overprint into a third colour where they meet, a registration tick on the
 * rim, and the bolt in ink at the centre. Nothing moves — it is a printed
 * thing, and it is drawn once.
 */
function EmptyQueue() {
  return (
    <div className="im-people-empty" role="status">
      <span className="im-people-empty-art" aria-hidden="true">
        <span className="im-people-empty-stage">
          <Halftone className="im-people-empty-field" id="im-dots-empty" />
          <span className="im-people-empty-plate im-people-empty-plate-1" />
          <Blob className="im-people-empty-plate im-people-empty-plate-2" variant={3} />
          <span className="im-people-empty-plate im-people-empty-plate-3" />
        </span>

        {/* The rim sits outside the window, so the plates read as printed
            under it rather than inside a ring. */}
        <svg className="im-people-empty-rim" viewBox="0 0 140 140" aria-hidden="true">
          <circle className="im-people-empty-rim-line" cx="70" cy="70" r="66" />
          {/* Registration ticks at the quarters, the way a plate is squared
              up on press — they straddle the rim rather than sit beside it. */}
          <path
            className="im-people-empty-tick"
            d="M70 0v8M70 140v-8M0 70h8M140 70h-8"
          />
        </svg>

        <span className="im-people-empty-bolt"><Bolt /></span>
      </span>

      <p className="im-display im-display-lg im-people-empty-title">Nobody yet</p>
      <Squiggle className="im-people-empty-squiggle" />
      <p className="im-lede im-people-empty-lede">Be the first.</p>
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
