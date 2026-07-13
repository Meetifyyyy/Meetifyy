import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import styles from './CampusPage.module.css';
import CrewCard from '../components/crew/CrewCard';
import { Plus, Search, ArrowLeft } from 'lucide-react';

export default function ActivitiesPage() {
  const navigate = useNavigate();
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
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      <div className={`${styles.headerBanner} ${styles.compactHeader}`}>
        <header className={styles.header}>
          {showSearch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', minHeight: '42px' }}>
              <button
                className={styles.headerSquareBtn}
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
              <div className={styles.headerLeftGroup}>
                <button className={styles.headerSquareBtn} onClick={() => navigate('/campus')} title="Back">
                  <ArrowLeft size={20} />
                </button>
                <h1 className={styles.collegeTitle} style={{ margin: 0 }}>Campus Activities</h1>
              </div>
              <div className={styles.headerActions}>
                <button className={styles.headerSquareBtn} onClick={() => setShowSearch(true)} title="Search">
                  <Search size={20} />
                </button>
                <button className={styles.headerSquareBtn} onClick={() => navigate('/crew/create')} title="Create Activity">
                  <Plus size={20} />
                </button>
              </div>
            </>
          )}
        </header>
      </div>

      <div className={styles.campusBody}>
        {/* Templates list */}
        <div className={styles.templatesRow} style={{ paddingTop: '0.5rem', paddingBottom: '1rem', marginTop: '-0.5rem', marginBottom: '-1rem' }}>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>☕</span>
            <span className={styles.templateTitle}>Coffee Meetup</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Coffee Meetup', coverImage: 'https://media.giphy.com/media/l0Iy6MiE0JJkimBIA/giphy.gif' } } })}>+ Add</button>
          </div>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>🍿</span>
            <span className={styles.templateTitle}>Movie Night</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Movie Night', coverImage: 'https://media.giphy.com/media/3o7527pa7qs9kCG78A/giphy.gif' } } })}>+ Add</button>
          </div>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>🎮</span>
            <span className={styles.templateTitle}>Gaming Night</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Gaming Night', coverImage: 'https://media.giphy.com/media/XABKMfQtWhvVq/giphy.gif' } } })}>+ Add</button>
          </div>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>🚶</span>
            <span className={styles.templateTitle}>Campus Walk</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Campus Walk', coverImage: 'https://media.giphy.com/media/3o6Mb57gCEJqpMxF68/giphy.gif' } } })}>+ Add</button>
          </div>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>🍕</span>
            <span className={styles.templateTitle}>Free Food</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Free Food', coverImage: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif' } } })}>+ Add</button>
          </div>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>🎤</span>
            <span className={styles.templateTitle}>Open Mic</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Open Mic', coverImage: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif' } } })}>+ Add</button>
          </div>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>🎨</span>
            <span className={styles.templateTitle}>Art Jam</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Art Jam', coverImage: 'https://media.giphy.com/media/l3q2JLW2x2eMm/giphy.gif' } } })}>+ Add</button>
          </div>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>🚀</span>
            <span className={styles.templateTitle}>Hackathon Team</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Hackathon Team', coverImage: 'https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif' } } })}>+ Add</button>
          </div>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>📖</span>
            <span className={styles.templateTitle}>Study Group</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Study Group', coverImage: 'https://media.giphy.com/media/WoWm8YzFQJg5i/giphy.gif' } } })}>+ Add</button>
          </div>
          <div className={styles.templateCard}>
            <span className={styles.templateEmoji}>⚽</span>
            <span className={styles.templateTitle}>Sports Match</span>
            <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus/activities', prefill: { title: 'Sports Match', coverImage: 'https://media.giphy.com/media/dXZfCHX4Hqvdm/giphy.gif' } } })}>+ Add</button>
          </div>
        </div>

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
