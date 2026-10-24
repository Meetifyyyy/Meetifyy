import { useState } from 'react';
import { getActivity } from '../../constants/matchConstants';
import PeopleSummary from '../people/PeopleSummary';
import PeopleList from '../people/PeopleList';
import {
  ActivityIcon, RefreshIcon, SpinnerIcon, PinIcon, ChatIcon,
} from '../art/icons';
import { MeetScene, RosterScene } from '../art/CampusMap';

/**
 * Who is searching right now — the screen Instant Match opens on.
 *
 * Every line here is a column of that person's own queue entry: the activity
 * they picked, when they want to meet, the area they typed in and the one-line
 * detail, all of it exactly as the matcher reads it. Nothing is derived and
 * nothing is filled in — a person who gave no area simply has no area line, so
 * the list can never claim more than someone actually said.
 *
 * Folded first: the map with everyone pinned, and one box of faces. Tapping
 * the box slides to the list, where any of them can be asked to match
 * directly (PeopleList). Matching through the queue still works the same;
 * a request is the second way in.
 *
 * Presentational: the roster is read by the sheet, which needs to know whether
 * there is anything to list before it decides to draw its own heading.
 */
export default function PeopleStep({ people, loading, error, retry }) {
  const [view, setView] = useState('map');

  if (loading) return <RosterLoader />;
  if (error) return <RosterError message={error} onRetry={retry} />;
  if (!people.length) return <EmptyQueue />;

  if (view === 'list') {
    return (
      <div className="im-search-slide" data-dir="forward">
        <PeopleList people={people} onBack={() => setView('back')} />
      </div>
    );
  }

  const pins = people.map((p) => {
    const activity = getActivity(p.activity);
    return {
      ...p,
      ink: activity ? { light: activity.ink, dark: activity.inkDark } : null,
    };
  });

  return (
    <div className="im-roster im-search-slide" data-dir={view === 'back' ? 'back' : 'none'}>
      <RosterScene people={pins} className="im-roster-map" />
      <PeopleSummary people={people} onOpen={() => setView('list')} />
    </div>
  );
}

/** One spinner, centred. A skeleton promised a list before we knew there was
 *  one to show — and on an empty queue it was a lie the next frame corrected. */
function RosterLoader() {
  return (
    <div className="im-people-loader" role="status">
      <SpinnerIcon />
      <span className="im-sr-only">Loading who is searching</span>
    </div>
  );
}

function RosterError({ message, onRetry }) {
  return (
    <div className="im-state" role="alert">
      <MeetScene variant="ended" className="im-state-art im-scene-fade" />
      <h3 className="im-state-title">Couldn&apos;t load who&apos;s searching</h3>
      <p className="im-lede">{message}</p>
      <button type="button" className="im-btn im-btn-sm" onClick={onRetry}>
        <RefreshIcon />
        Try again
      </button>
    </div>
  );
}

/**
 * Nobody is waiting. Every road on the map leads to the user's own pin, with
 * nobody on them yet: the spot is theirs to take. Below it, how it works in
 * three lines, so an empty queue still tells a first-time user what happens
 * when they press the button.
 */
function EmptyQueue() {
  return (
    <div className="im-state im-state-empty" role="status">
      <MeetScene variant="empty" className="im-empty-art">
        <span className="im-empty-label">Your spot</span>
      </MeetScene>
      <h3 className="im-state-title im-empty-title">Nobody yet</h3>
      <p className="im-lede im-empty-lede">Be the first.</p>
      <p className="im-state-note">
        Start a search and anyone who joins after you is matched with you first.
      </p>
      <ol className="im-how" aria-label="How Instant Match works">
        <li>
          <span className="im-how-icon" aria-hidden="true"><ActivityIcon id="coffee" /></span>
          <span>Pick what you&apos;re up for</span>
        </li>
        <li>
          <span className="im-how-icon" aria-hidden="true"><PinIcon /></span>
          <span>We find someone free nearby</span>
        </li>
        <li>
          <span className="im-how-icon" aria-hidden="true"><ChatIcon /></span>
          <span>Chat for 24 hours, then meet</span>
        </li>
      </ol>
    </div>
  );
}
