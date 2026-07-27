import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';

import sharedStyles from '../components/skeletons/CampusShared.module.css';
import CrewCard from '@features/crew/components/cards/CrewCard';
import ActivityTemplatesRow from '../components/ActivityTemplatesRow';
import { Plus, Search, ArrowLeft } from 'lucide-react';
import { useData } from '@shared/hooks/useData';


export default function ActivitiesPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();
  const { campusCrewActivities } = useData();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const filteredActivities = useMemo(() => {
    // Only show activities visible to this college
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

    list = list.filter(act => !isActivityEnded(act));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(act =>
        act.title.toLowerCase().includes(q) ||
        act.description?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [campusCrewActivities, searchQuery]);

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
                <button className={sharedStyles.headerSquareBtn} onClick={() => navigate('/crew/create')} title="Create Activity">
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
                onClick={() => navigate(`/crew/${act.id}`, { state: { activity: act } })}
              />
            ))
          ) : (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '3rem 0' }}>
              No activities yet.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
