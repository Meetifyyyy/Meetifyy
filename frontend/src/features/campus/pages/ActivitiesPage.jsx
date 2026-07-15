import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/context/DataContext';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import CrewCard from '@features/crew/components/cards/CrewCard';
import ActivityTemplatesRow from '../components/ActivityTemplatesRow';
import { Plus, Search, ArrowLeft } from 'lucide-react';

export default function ActivitiesPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();
  const { crewActivities, communities } = useData();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const userCollegeId = currentUser?.collegeId || 'gla';
  const collegeCommunity = communities[userCollegeId] || { name: 'GLA University' };
  const collegeName = collegeCommunity.name;

  const filteredActivities = useMemo(() => {
    // Only show activities visible to this college
    let list = crewActivities.filter(act =>
      !act.shareToSchool || act.hostCollege === collegeName
    );

    // Filter out past activities
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    list = list.filter(act => {
      if (!act.date) return true;
      const d = new Date(act.date);
      d.setHours(0, 0, 0, 0);
      return d >= today;
    });

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(act =>
        act.title.toLowerCase().includes(q) ||
        act.description?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [crewActivities, collegeName, searchQuery, userCollegeId]);

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
