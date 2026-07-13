import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useTheme } from '../context/ThemeContext';
import { showToast } from '../utils/toast';
import Avatar from '../components/common/Avatar';
import styles from './CampusPage.module.css';
import GroupCreationModal from '../components/common/GroupCreationModal';
import CrewCard from '../components/crew/CrewCard';
import {
  GraduationCap,
  CheckCircle,
  Share2,
  Plus,
  Search,
  Filter,
  Users,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  Calendar,
  Layers,
  MapPin,
  Lock,
  Mail,
  ShieldCheck
} from 'lucide-react';

export default function CampusPage() {
  const navigate = useNavigate();
  const { currentUser, updateProfile } = useAuth();
  const { crewActivities, users, communities, campusGroups, joinCommunity, toggleJoinCommunity, toggleJoinCampusGroup, addCrewActivity, addCommunity, createCampusGroup } = useData();
  const { theme } = useTheme();

  // Active Main Tab: 'directory' | 'activities' | 'groups'
  const [activeTab, setActiveTab] = useState('directory');
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);

  // Verification State (for simulation)
  const [emailInput, setEmailInput] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [step, setStep] = useState('email'); // 'email' | 'code'

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState('Upcoming'); // 'Upcoming' | 'Ongoing' | 'Past'



  // Pagination for Activities
  const [activitiesLimit, setActivitiesLimit] = useState(3);

  // Modal Creation States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [modalType, setModalType] = useState('activity'); // 'activity' | 'group'

  // Form States for Creation
  const [newActTitle, setNewActTitle] = useState('');
  const [newActDesc, setNewActDesc] = useState('');
  const [newActLoc, setNewActLoc] = useState('');
  const [newActCat, setNewActCat] = useState('Tech');

  const [newGrpName, setNewGrpName] = useState('');
  const [newGrpDesc, setNewGrpDesc] = useState('');
  const [newGrpCat, setNewGrpCat] = useState('Tech');

  // Identify College
  const userCollegeId = currentUser?.collegeId || 'gla';
  const collegeCommunity = communities[userCollegeId] || { name: 'GLA University', members: 4200, online: 854 };
  const collegeName = collegeCommunity.name;

  // 1. Get Campus Activities
  const filteredActivities = useMemo(() => {
    let list = crewActivities.filter(act => 
      !act.shareToSchool || act.hostCollege === collegeName
    );

    // Apply Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(act => 
        act.title.toLowerCase().includes(q) || 
        act.description?.toLowerCase().includes(q)
      );
    }

    // Apply Category Filter
    if (selectedCategory !== 'All') {
      list = list.filter(act => act.category === selectedCategory);
    }

    // Apply Status Filter (simulated)
    const now = new Date();
    list = list.filter(act => {
      // Simple status derivation based on title or simulation
      if (statusFilter === 'Ongoing') {
        return act.title.toLowerCase().includes('live') || act.title.toLowerCase().includes('workshop') || act.id.hashCode % 3 === 0;
      } else if (statusFilter === 'Past') {
        return act.title.toLowerCase().includes('past') || act.title.toLowerCase().includes('wrap') || act.id.hashCode % 5 === 0;
      }
      return !act.title.toLowerCase().includes('past');
    });

    return list;
  }, [crewActivities, collegeName, searchQuery, selectedCategory, statusFilter, userCollegeId]);

  const displayedActivities = useMemo(() => {
    return filteredActivities.slice(0, activitiesLimit);
  }, [filteredActivities, activitiesLimit]);

  // Top 2 most recent upcoming campus activities
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

  // 3. Get Campus Groups
  const collegeGroups = useMemo(() => {
    let list = Object.values(campusGroups).filter(c => c.collegeId === userCollegeId);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => 
        c.name.toLowerCase().includes(q) || 
        c.desc?.toLowerCase().includes(q)
      );
    }

    if (selectedCategory !== 'All') {
      list = list.filter(c => c.categories?.includes(selectedCategory.toLowerCase()));
    }

    return list;
  }, [campusGroups, userCollegeId, searchQuery, selectedCategory]);

  // 4. Get Suggested Users for "You May Know"
  const suggestedUsers = useMemo(() => {
    let list = Object.values(users).filter(u => u.collegeId === userCollegeId);
    list = list.filter(u => u.id !== currentUser?.id);
    return list.slice(0, 4); // show top 4 suggestions
  }, [users, userCollegeId, currentUser]);

  // Handle Join Activity
  const handleJoinActivity = (actId) => {
    showToast('Joined activity! 🚀');
  };

  // Handle Join/Leave Group
  const handleToggleGroup = (grpId) => {
    toggleJoinCampusGroup(grpId);
    showToast('Group preference updated! ✨');
  };

  // Simulated Verification Handlers
  const handleSendCode = (e) => {
    e.preventDefault();
    if (!emailInput.includes('@')) {
      showToast('Please enter a valid university email');
      return;
    }
    setStep('code');
    showToast('Verification code sent to ' + emailInput);
  };

  const handleVerifyCode = (e) => {
    e.preventDefault();
    if (verificationCode === '1234') {
      updateProfile({ verified: true });
      showToast('Campus Email Verified successfully! 🎓');
    } else {
      showToast('Incorrect verification code. Hint: Use 1234');
    }
  };

  // Handle Share Hub
  const handleShareHub = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('Campus Hub link copied to clipboard! 🔗');
  };

  // Handle Creating Activity or Group
  const handleCreateGroup = async (name, desc, avatar) => {
    const newId = await createCampusGroup(name, desc, avatar);
    showToast('Group created successfully! 🚀');
    navigate(`/messages/${newId}`);
  };

  // Handle Creating Activity or Group
  const handleCreateSubmit = (e) => {
    e.preventDefault();
    if (modalType === 'activity') {
      if (!newActTitle.trim()) return;
      addCrewActivity({
        id: `act_${Date.now()}`,
        hostId: currentUser?.id || 'current_user',
        hostName: currentUser?.displayName || 'You',
        hostAvatar: currentUser?.avatar || 'Y',
        hostCollege: collegeName,
        title: newActTitle,
        description: newActDesc,
        location: newActLoc,
        category: newActCat,
        dateLabel: 'Today',
        date: new Date().toISOString().split('T')[0],
        time: '6:00 PM',
        participants: [currentUser?.id || 'current_user']
      });
      showToast('Activity Published! 📅');
      setNewActTitle('');
      setNewActDesc('');
      setNewActLoc('');
    } else {
      if (!newGrpName.trim()) return;
      const newId = `gla_${newGrpName.toLowerCase().replace(/\s+/g, '_')}`;
      addCommunity({
        id: newId,
        name: newGrpName,
        desc: newGrpDesc,
        avatar: newGrpName.charAt(0),
        color: 'linear-gradient(135deg, #3B82F6, #10B981)',
        collegeId: userCollegeId,
        members: 1,
        online: 1,
        categories: [newGrpCat.toLowerCase()]
      });
      showToast('Campus Group Created! 👥');
      setNewGrpName('');
      setNewGrpDesc('');
    }
    setShowCreateModal(false);
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
              onClick={() => {
                if (activeTab === 'groups') {
                  setIsGroupModalOpen(true);
                } else {
                  setModalType('activity');
                  setShowCreateModal(true);
                }
              }}
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
          <div className={styles.templatesRow} style={{ paddingTop: '0.5rem', paddingBottom: '1rem', marginTop: '-0.5rem', marginBottom: '-1rem' }}>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>☕</span>
              <span className={styles.templateTitle}>Coffee Meetup</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Coffee Meetup', coverImage: 'https://media.giphy.com/media/l0Iy6MiE0JJkimBIA/giphy.gif' } } })}>+ Add</button>
            </div>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>🍿</span>
              <span className={styles.templateTitle}>Movie Night</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Movie Night', coverImage: 'https://media.giphy.com/media/3o7527pa7qs9kCG78A/giphy.gif' } } })}>+ Add</button>
            </div>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>🎮</span>
              <span className={styles.templateTitle}>Gaming Night</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Gaming Night', coverImage: 'https://media.giphy.com/media/XABKMfQtWhvVq/giphy.gif' } } })}>+ Add</button>
            </div>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>🚶</span>
              <span className={styles.templateTitle}>Campus Walk</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Campus Walk', coverImage: 'https://media.giphy.com/media/3o6Mb57gCEJqpMxF68/giphy.gif' } } })}>+ Add</button>
            </div>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>🍕</span>
              <span className={styles.templateTitle}>Free Food</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Free Food', coverImage: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif' } } })}>+ Add</button>
            </div>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>🎤</span>
              <span className={styles.templateTitle}>Open Mic</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Open Mic', coverImage: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif' } } })}>+ Add</button>
            </div>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>🎨</span>
              <span className={styles.templateTitle}>Art Jam</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Art Jam', coverImage: 'https://media.giphy.com/media/l3q2JLW2x2eMm/giphy.gif' } } })}>+ Add</button>
            </div>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>🚀</span>
              <span className={styles.templateTitle}>Hackathon Team</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Hackathon Team', coverImage: 'https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif' } } })}>+ Add</button>
            </div>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>📖</span>
              <span className={styles.templateTitle}>Study Group</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Study Group', coverImage: 'https://media.giphy.com/media/WoWm8YzFQJg5i/giphy.gif' } } })}>+ Add</button>
            </div>
            <div className={styles.templateCard}>
              <span className={styles.templateEmoji}>⚽</span>
              <span className={styles.templateTitle}>Sports Match</span>
              <button className={styles.templateAddBtn} onClick={() => navigate('/crew/create', { state: { returnTo: '/campus', prefill: { title: 'Sports Match', coverImage: 'https://media.giphy.com/media/dXZfCHX4Hqvdm/giphy.gif' } } })}>+ Add</button>
            </div>
          </div>
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
