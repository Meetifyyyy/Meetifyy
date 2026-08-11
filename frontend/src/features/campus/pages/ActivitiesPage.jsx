import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';

import sharedStyles from '../components/skeletons/CampusShared.module.css';
import CrewCard from '@features/crew/components/cards/CrewCard';
import ActivityTemplatesRow from '../components/ActivityTemplatesRow';
import { Plus, Search, ArrowLeft } from 'lucide-react';
import { useCampusActivities } from '@shared/hooks/useCrew';
import { useDebounce } from '@shared/hooks/useDebounce';
import { mapActivity } from '@shared/utils/mapActivity';


export default function ActivitiesPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // Search runs on the server (matches title/description/location across ALL
  // campus activities, not just the pages already loaded). Debounced.
  const debouncedSearch = useDebounce(searchQuery, 300);
  const { campusActivities: rawCampusActivities, hasNextPage, isFetchingNextPage, fetchNextPage } = useCampusActivities(debouncedSearch);
  const campusCrewActivities = useMemo(() => (rawCampusActivities || []).map(mapActivity), [rawCampusActivities]);

  // Infinite-scroll sentinel.
  const sentinelRef = useRef(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filteredActivities = useMemo(() => {
    // Server already scopes to campus + open + upcoming; this is a light client
    // safety refinement for visibility/ended edge cases. Search is server-side.
    let list = campusCrewActivities;

    const isActivityEnded = (act) => {
      if (!act) return true;
      const status = (act.status || '').toUpperCase();
      if (status === 'ENDED' || status === 'CANCELLED' || status === 'CLOSED' || status === 'COMPLETED') return true;
      const startDateStr = act.startDate || act.date;
      if (startDateStr) {
        const start = new Date(startDateStr);
        if (!isNaN(start.getTime())) {
          let durationHours = 2;
          if (act.duration) {
            const match = String(act.duration).match(/(\d+)/);
            if (match) durationHours = parseInt(match[1], 10);
          }
          const calculatedEnd = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
          if (new Date() >= calculatedEnd) return true;
        }
      }
      return false;
    };

    const isCampusActivity = (act) => {
      if (!act) return false;
      const vis = String(act.visibility || '').toUpperCase();
      if (vis === 'PRIVATE') return false;
      if (vis === 'COLLEGE_ONLY' || vis === 'COLLEGE' || act.shareToCampus || act.isCollegeOnly) return true;
      const join = String(act.whoCanJoin || '').toLowerCase();
      if (join === 'college' || join === 'school' || join === 'campus') return true;
      return false;
    };

    list = list.filter(act => isCampusActivity(act) && !isActivityEnded(act));

    return list;
  }, [campusCrewActivities]);

  return (
    <main className={`centre centre-wide ${sharedStyles.hubContainer}`}>
      <div className={`${sharedStyles.headerBanner} ${sharedStyles.compactHeader}`}>
        <header className={sharedStyles.header}>
          {showSearch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', minHeight: '42px' }}>
              <button
                className={sharedStyles.headerSquareBtn}
                onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                title="Close Search"
              >
                <ArrowLeft size={20} />
              </button>
              <input
                type="text"
                placeholder="Search activities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, border: 'none', background: 'transparent', color: 'white', padding: '0.5rem', outline: 'none', fontSize: '1rem' }}
                autoFocus
              />
            </div>
          ) : (
            <>
              <div className={sharedStyles.headerLeftGroup}>
                <button className={sharedStyles.headerSquareBtn} onClick={() => goBack('/campus')} title="Back">
                  <ArrowLeft size={20} />
                </button>
                <h1 className={sharedStyles.collegeTitle} style={{ margin: 0 }}>Campus Activities</h1>
              </div>
              <div className={sharedStyles.headerActions}>
                <button className={sharedStyles.headerSquareBtn} onClick={() => setShowSearch(true)} title="Search">
                  <Search size={20} />
                </button>
                <button className={sharedStyles.headerSquareBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities' } })} title="Create Activity">
                  <Plus size={20} />
                </button>
              </div>
            </>
          )}
        </header>
      </div>

      <div className={sharedStyles.campusBody}>
        {/* Templates list */}
        <ActivityTemplatesRow returnTo="/campus/activities" />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))', gap: '0.75rem' }}>
          {filteredActivities.length > 0 ? (
            filteredActivities.map(act => (
              <CrewCard
                key={act.id}
                activity={act}
                onClick={() => navigate(`/crew/${act.id}`, { state: { activity: act, from: '/campus/activities' } })}
              />
            ))
          ) : (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '3rem 0' }}>
              No activities yet.
            </p>
          )}
          <div ref={sentinelRef} style={{ gridColumn: '1 / -1', height: 1 }} />
          {isFetchingNextPage && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '1rem 0', gridColumn: '1 / -1', fontSize: '0.85rem' }}>Loading more…</p>
          )}
        </div>
      </div>
    </main>
  );
}
