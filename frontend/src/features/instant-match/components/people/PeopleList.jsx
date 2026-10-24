import { useState } from 'react';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useInstantMatch } from '../../context/InstantMatchContext';
import {
  getActivity, getAreaLabel, getTimePreference,
} from '../../constants/matchConstants';
import { ActivityIcon, AreaIcon, TimeIcon, BackIcon } from '../art/icons';
import { MatchMark } from '../decor/Decor';
import Face from '../art/Face';
import RequestMatchModal from '../modals/RequestMatchModal';
import '../../styles/searching-screen.css';

/**
 * Everyone searching right now, each with a match button.
 *
 * Every line is a column of that person's own queue entry — activity, timing,
 * area, detail — exactly as the matcher reads it; a field they left empty is
 * an absent line, never a placeholder. A tap on the match button asks first
 * (RequestMatchModal). From the opening screen the request also starts this
 * user's search; mid-search it simply interrupts it.
 */
export default function PeopleList({ people, onBack }) {
  const { requestMatch, busy } = useInstantMatch();
  const [asking, setAsking] = useState(null);

  // The system Back slides back to the summary first, the way the arrow
  // does, instead of closing the whole sheet from inside the list.
  useOverlayBack(true, onBack);

  return (
    <div className="im-people-view">
      <div className="im-people-bar">
        <button type="button" className="im-also-back" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <span className="im-also-title">
          {people.length === 1 ? '1 person searching' : `${people.length} people searching`}
        </span>
      </div>

      <ul className="im-people" aria-label="People searching on Instant Match">
        {people.map((person, i) => (
          <PersonRow
            key={person.user.id}
            person={person}
            index={i}
            onAsk={() => setAsking(person)}
          />
        ))}
      </ul>

      {asking && (
        <RequestMatchModal
          person={asking}
          busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={async () => {
            await requestMatch(asking);
            setAsking(null);
          }}
        />
      )}
    </div>
  );
}

function PersonRow({ person, index, onAsk }) {
  const activity = getActivity(person.activity);
  const when = getTimePreference(person.timePreference);
  const areaLabel = getAreaLabel(person.area);
  const name = person.user.displayName || person.user.username || 'A student';
  const handle = person.user.username && person.user.displayName
    ? `@${person.user.username}`
    : null;
  const waited = waitedFor(person.joinedAt);

  return (
    <li className="im-person" style={{ '--im-i': Math.min(index, 8) }}>
      <span className="im-person-face">
        <Face avatar={person.user.avatar} name={name} size={44} />
        <span className="im-person-live" aria-hidden="true" />
      </span>

      <div className="im-person-text">
        <p className="im-person-head">
          <span className="im-person-name">{name}</span>
          {handle && <span className="im-person-handle">{handle}</span>}
          {waited && <span className="im-person-wait">{waited}</span>}
        </p>

        <p className="im-person-activity">
          <span className="im-person-chip">
            <ActivityIcon id={person.activity} className="im-duo" />
            <span className="im-person-label">{activity?.label ?? person.activity}</span>
          </span>
          {person.optionalDetail && (
            <span className="im-person-detail">{person.optionalDetail}</span>
          )}
        </p>

        {(when || areaLabel) && (
          <p className="im-person-meta">
            {when && (
              <span className="im-person-meta-item">
                <TimeIcon id={when.id} />
                {when.title}
              </span>
            )}
            {/* Only rendered when there is something to say: an area nobody
                gave is an absent line, never an "unknown" placeholder. */}
            {areaLabel && (
              <span className="im-person-meta-item">
                <AreaIcon id={person.area} />
                {areaLabel}
              </span>
            )}
          </p>
        )}
      </div>

      <button
        type="button"
        className="im-also-match"
        onClick={onAsk}
        aria-label={`Send a match request to ${name}`}
      >
        <MatchMark />
      </button>
    </li>
  );
}

/** How long they have been waiting, from the queue row's own `joinedAt`. */
function waitedFor(joinedAt) {
  if (!Number.isFinite(joinedAt)) return null;
  const mins = Math.floor((Date.now() - joinedAt) / 60000);
  if (mins < 1) return 'just joined';
  return `waiting ${mins}m`;
}
