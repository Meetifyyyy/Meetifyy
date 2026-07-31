import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/hooks/useData';
import { useCampusCommunities } from '@shared/hooks/useCommunities';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './CampusPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import CreateCommunityModal from '@features/communities/components/modals/CreateCommunityModal';
import CrewCard from '@features/crew/components/cards/CrewCard';
import { Plus, Users, Calendar } from 'lucide-react';
import ActivityTemplatesRow from '../components/ActivityTemplatesRow';

export default function CampusPage() {
  const navigate = useNavigate();
  const { currentUser, collegeName: authCollegeName } = useAuth();
  const { campusCrewActivities, campusUsers, createCampusGroup } = useData();
  const { campusCommunities } = useCampusCommunities();

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isPlusMenuOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsPlusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPlusMenuOpen]);

  const userCollegeId = currentUser?.collegeId || 'unknown';
  const collegeCommunity = campusCommunities[userCollegeId];
  const collegeName = collegeCommunity?.name || authCollegeName;

  const recentActivities = useMemo(() => {
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

    return campusCrewActivities
      .filter(act => isCampusActivity(act) && !isActivityEnded(act))
      .sort((a, b) => new Date(a.startDate || a.date) - new Date(b.startDate || b.date))
      .slice(0, 2);
  }, [campusCrewActivities]);

  const suggestedUsers = useMemo(() => {
    let list = Object.values(campusUsers).filter(u => u.collegeId === userCollegeId);
    list = list.filter(u => u.id !== currentUser?.id);
    return list.slice(0, 4);
  }, [campusUsers, userCollegeId, currentUser]);

  const handleCreateGroup = async (id) => {
    navigate(`/communities/${id}`, { state: { from: '/campus' } });
  };

  return (
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      {/* HEADER SECTION */}
      <div className={styles.headerBanner}>
        <header className={styles.header}>
          <h1 className={styles.collegeTitle}>{collegeName}</h1>

          <div className={`${styles.headerActions} ${styles.headerActionsRelative}`} ref={menuRef}>
            <button
              className={styles.headerSquareBtn}
              onClick={() => setIsPlusMenuOpen(prev => !prev)}
              aria-label="Create menu"
            >
              <Plus size={20} />
            </button>

            {isPlusMenuOpen && (
              <div className={styles.plusDropdownMenu}>
                <button
                  className={styles.plusMenuItem}
                  onClick={() => {
                    setIsPlusMenuOpen(false);
                    navigate('/crew/create', { state: { returnTo: '/campus' } });
                  }}
                >
                  <Calendar size={18} className={styles.plusMenuIcon} />
                  <span>Create activity</span>
                </button>

                <button
                  className={styles.plusMenuItem}
                  onClick={() => {
                    setIsPlusMenuOpen(false);
                    setIsGroupModalOpen(true);
                  }}
                >
                  <Users size={18} className={styles.plusMenuIcon} />
                  <span>Create community</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* NAVIGATION TABS */}
        <div className={styles.stickyNav}>
          <button
            className={styles.navTab}
            onClick={() => navigate('/campus/directory')}
          >
            <span className={styles.tabEmoji}>🤩</span>
            <span>Directory</span>
          </button>
          <button
            className={styles.navTab}
            onClick={() => navigate('/campus/activities')}
          >
            <span className={styles.tabEmoji}>🎟️</span>
            <span>Activities</span>
          </button>
          <button
            className={styles.navTab}
            onClick={() => navigate('/campus/communities')}
          >
            <span className={styles.tabEmoji}>🫧</span>
            <span>Communities</span>
          </button>
        </div>
      </div>

      {/* CAMPUS BODY SECTIONS */}
      <div className={styles.campusBody}>
        
        {/* Section 1: add your activity */}
        <section className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <span className={styles.sectionEmoji}>🎟️</span>
            <h2 className={styles.sectionTitleText}>add your activity</h2>
          </div>
          {/* Recent activities preview */}
          {recentActivities.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))', gap: '0.6rem' }}>
              {recentActivities.map(act => (
                <CrewCard
                  key={act.id}
                  activity={act}
                  onClick={() => navigate(`/crew/${act.id}`, { state: { activity: act, from: '/campus' } })}
                />
              ))}
            </div>
          )}
          <ActivityTemplatesRow returnTo="/campus" />
        </section>

        {/* Wrapper for Side by Side Sections on Desktop */}
        <div className={styles.sideBySideDesktop}>
          {/* Section 2: you may know */}
          <section className={styles.section}>
            <div className={styles.sectionHeaderRow}>
              <span className={styles.sectionEmoji}>🤩</span>
              <h2 className={styles.sectionTitleText}>you may know</h2>
            </div>
            <div className={styles.knowListContainer}>
              {suggestedUsers.map(user => (
                <div key={user.id} className={styles.knowCard} onClick={() => navigate(`/profile/${user.username}`, { state: { from: '/campus' } })} style={{ cursor: 'pointer' }}>
                  <Avatar
                    src={user.avatar}
                    name={user.displayName || user.username}
                    size="88px"
                    showInitials
                  />
                  <span className={styles.knowName}>{user.displayName}</span>
                </div>
              ))}
              {suggestedUsers.length === 0 && (
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>No suggestions available.</span>
              )}
            </div>
            <button className={styles.viewDirBtn} onClick={() => navigate('/campus/directory')}>
              View directory
            </button>
          </section>

          {/* Section 3: discover communities */}
          <section className={styles.section}>
            <div className={styles.sectionHeaderRow}>
              <span className={styles.sectionEmoji}>🫧</span>
              <h2 className={styles.sectionTitleText}>discover communities</h2>
            </div>
            <div className={styles.discoverGroupsCard} onClick={() => {
              setIsGroupModalOpen(true);
            }}>
              <div className={styles.dashedAddSquare}>
                <Users size={20} />
                <span className={styles.plusOverlay}>+</span>
              </div>
              <span className={styles.discoverGroupsText}>Create a campus community</span>
            </div>
          </section>
        </div>
      </div>


      {isGroupModalOpen && (
        <CreateCommunityModal 
          onClose={() => setIsGroupModalOpen(false)} 
          onCreated={handleCreateGroup} 
          isCampusCommunity={true}
        />
      )}
    </main>
  );
}
