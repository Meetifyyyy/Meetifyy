import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/context/DataContext';
import { useTheme } from '@shared/context/ThemeContext';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './CampusPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import GroupCreationModal from '@shared/components/modals/GroupCreationModal';
import CrewCard from '@features/crew/components/cards/CrewCard';
import { Plus, Users } from 'lucide-react';
import ActivityTemplatesRow from '../components/ActivityTemplatesRow';

export default function CampusPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { crewActivities, users, communities, createCampusGroup } = useData();
  const { theme } = useTheme();

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);

  const userCollegeId = currentUser?.collegeId || 'gla';
  const collegeCommunity = communities[userCollegeId] || { name: 'GLA University', members: 4200, online: 854 };
  const collegeName = collegeCommunity.name;

  const recentActivities = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return crewActivities
      .filter(act => {
        if (!act.date) return false;
        const d = new Date(act.date);
        d.setHours(0, 0, 0, 0);
        return d >= today && (!act.shareToSchool || act.hostCollege === collegeName);
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 2);
  }, [crewActivities, collegeName]);

  const suggestedUsers = useMemo(() => {
    let list = Object.values(users).filter(u => u.collegeId === userCollegeId);
    list = list.filter(u => u.id !== currentUser?.id);
    return list.slice(0, 4);
  }, [users, userCollegeId, currentUser]);

  const handleCreateGroup = async (name, desc, avatar) => {
    const newId = await createCampusGroup(name, desc, avatar);
    showToast('Group created successfully! 🚀');
    navigate(`/messages/${newId}`);
  };



  return (
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      {/* HEADER SECTION */}
      <div className={styles.headerBanner}>
        <header className={styles.header}>
          <h1 className={styles.collegeTitle}>GLA University</h1>

          <div className={styles.headerActions}>

            <button
              className={styles.headerSquareBtn}
              onClick={() => navigate('/crew/create')}
            >
              <Plus size={20} />
            </button>
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
            onClick={() => navigate('/campus/groups')}
          >
            <span className={styles.tabEmoji}>🫧</span>
            <span>Groups</span>
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
                  onClick={() => navigate(`/crew/${act.id}`, { state: { activity: act } })}
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
                <div key={user.id} className={styles.knowCard} onClick={() => navigate(`/profile/${user.username}`)} style={{ cursor: 'pointer' }}>
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

          {/* Section 3: discover groups */}
          <section className={styles.section}>
            <div className={styles.sectionHeaderRow}>
              <span className={styles.sectionEmoji}>🫧</span>
              <h2 className={styles.sectionTitleText}>discover groups</h2>
            </div>
            <div className={styles.discoverGroupsCard} onClick={() => {
              setIsGroupModalOpen(true);
            }}>
              <div className={styles.dashedAddSquare}>
                <Users size={20} />
                <span className={styles.plusOverlay}>+</span>
              </div>
              <span className={styles.discoverGroupsText}>Create a campus group</span>
            </div>
          </section>
        </div>
      </div>


      {isGroupModalOpen && (
        <GroupCreationModal 
          onClose={() => setIsGroupModalOpen(false)} 
          onCreate={handleCreateGroup} 
          isDark={theme === 'dark'} 
        />
      )}
    </main>
  );
}
