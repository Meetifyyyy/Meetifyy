import { memo, useState, useEffect } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { useSearchingNow } from '../../hooks/useSearchingNow';
import {
  getActivityLabel, getTimePreference, getAreaLabel,
} from '../../constants/matchConstants';
import { SearchScene } from '../art/CampusMap';
import PeopleSummary from '../people/PeopleSummary';
import PeopleList from '../people/PeopleList';
import {
  ActivityIcon, AreaIcon, TimeIcon,
} from '../art/icons';
import '../../styles/searching-screen.css';

const STATUS_LINES = [
  'Looking around campus',
  'Checking who is free',
  'Lining up the best fit',
  'Still looking',
];

/*
 * ── Why the timers live in leaves ─────────────────────────────────────────
 *
 * A search runs for minutes. Each ticking value sits in the smallest
 * component that displays it, so a tick re-renders a single text node, and
 * the map — memoised, with every frame owned by CSS — is never touched again
 * after it mounts.
 */

/** The m:ss readout. Owns its own clock. */
const ElapsedReadout = memo(function ElapsedReadout() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="im-search-elapsed">
      <span className="im-sr-only">Time spent searching: </span>
      {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
    </span>
  );
});

/** The rotating reassurance line. Also a live region, so it is announced. */
const StatusLine = memo(function StatusLine({ connected }) {
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (!connected) return undefined;
    const id = window.setInterval(
      () => setLine((i) => (i + 1) % STATUS_LINES.length),
      3200,
    );
    return () => window.clearInterval(id);
  }, [connected]);

  return (
    <p className="im-search-status" role="status" aria-live="polite">
      <span className={`im-live-dot ${connected ? '' : 'is-paused'}`} aria-hidden="true" />
      <span key={connected ? line : 'offline'} className="im-search-status-text">
        {connected ? STATUS_LINES[line] : 'Reconnecting. Your place is held.'}
      </span>
      {connected && <ElapsedReadout />}
    </p>
  );
});

/**
 * The waiting room.
 *
 * Two jobs: make an indefinite wait feel deliberate rather than broken, and
 * make it obvious the search survives minimising the sheet. The actions are
 * rendered by the sheet's footer so they never scroll out of reach.
 *
 * Two views that slide between each other: the search itself, and the
 * people searching alongside (each of whom can be asked directly). The
 * roster is read here, once, so both views show the same live list.
 */
export default function SearchingScreen() {
  const { formData, connected } = useInstantMatch();
  const { currentUser } = useAuth();
  const { people } = useSearchingNow(true);
  const [view, setView] = useState('search');

  const activityLabel = getActivityLabel(formData.activity, 'a hangout');
  const when = getTimePreference(formData.timePreference);
  const areaLabel = getAreaLabel(formData.location?.area);
  const others = people ? people.filter((p) => p.user?.id !== currentUser?.id) : null;

  // Everyone left while the list was open: show the search again rather than
  // an empty list with a count of nobody.
  if (view === 'people' && others?.length) {
    return (
      <div className="im-search-slide" data-dir="forward">
        <PeopleList people={others ?? []} onBack={() => setView('back')} />
      </div>
    );
  }

  const same = others ? others.filter((p) => p.activity === formData.activity).length : 0;

  return (
    <div className="im-search im-search-slide" data-dir={view === 'back' ? 'back' : 'none'}>
      <SearchScene className="im-search-scene" activity={formData.activity} />

      <div className="im-search-copy">
        <h3 className="im-title im-title-lg">
          Finding someone for {activityLabel.toLowerCase()}
        </h3>
        <StatusLine connected={connected} />
      </div>

      <ul className="im-search-chips" aria-label="Your search">
        <li className="im-chip">
          <ActivityIcon id={formData.activity} />
          {activityLabel}
        </li>
        {when && (
          <li className="im-chip">
            <TimeIcon id={when.id} />
            {when.title}
          </li>
        )}
        {areaLabel && (
          <li className="im-chip">
            <AreaIcon id={formData.location.area} />
            {areaLabel}
          </li>
        )}
      </ul>

      {others && others.length > 0 && (
        <PeopleSummary
          people={others}
          detail={same > 0
            ? `${same} also ${same === 1 ? 'wants' : 'want'} ${activityLabel.toLowerCase()}`
            : undefined}
          onOpen={() => setView('people')}
        />
      )}
    </div>
  );
}
