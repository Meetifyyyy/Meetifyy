import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';
import { communitiesApi } from '@shared/api/apiClient';

import { useTheme } from '@shared/context/ThemeContext';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './GroupsPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import { Plus, Search, ArrowLeft, Users } from 'lucide-react';
import GroupCreationModal from '@shared/components/modals/GroupCreationModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useData } from '@shared/hooks/useData';

export default function GroupsPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { theme } = useTheme();

  const joinMutation = useMutation({
    mutationFn: (id) => communitiesApi.join(id),
    onSuccess: () => queryClient.invalidateQueries(['communities']),
  });

  const leaveMutation = useMutation({
    mutationFn: (id) => communitiesApi.leave(id),
    onSuccess: () => queryClient.invalidateQueries(['communities']),
  });

  const createMutation = useMutation({
    mutationFn: (data) => communitiesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries(['communities']),
  });

  const toggleJoinCampusGroup = (id) => {
    const isJoined = currentUser?.campusGroups?.map(String).includes(String(id));
    if (isJoined) {
      leaveMutation.mutate(id);
    } else {
      joinMutation.mutate(id);
    }
  };

  const { createCampusGroup, requestToJoinGroup } = useData();

  const { data: communitiesData = [] } = useQuery({ 
    queryKey: ['communities'], 
    queryFn: communitiesApi.getAll 
  });
  
  const campusGroups = communitiesData;

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  const userCollegeId = currentUser?.collegeId || 'gla';

  const collegeGroups = useMemo(() => {
    let list = campusGroups.filter(c => c.collegeId === userCollegeId);

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

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('Groups link copied! 🔗');
  };

  const handleToggleGroup = (grpId) => {
    toggleJoinCampusGroup(grpId);
    showToast('Group preference updated! ✨');
  };

  const handleCreateGroup = async (name, desc, avatar) => {
    const newId = await createCampusGroup(name, desc, avatar);
    showToast('Group created successfully! 🚀');
    navigate(`/messages/${newId}`);
  };

  const handleGroupClick = (group) => {
    const isMember = currentUser?.campusGroups?.map(String).includes(String(group.id));
    if (isMember) {
      navigate(`/messages/${group.id}`);
    } else {
      setSelectedGroup(group);
      setIsJoinModalOpen(true);
    }
  };

  const handleJoinConfirm = () => {
    if (!selectedGroup) return;
    if (selectedGroup.whoCanJoin === 'Request required') {
      requestToJoinGroup(selectedGroup.id, currentUser?.id);
      showToast('Join request sent successfully! 📨');
    } else {
      toggleJoinCampusGroup(selectedGroup.id);
      showToast('Joined group successfully! 🎉');
      navigate(`/messages/${selectedGroup.id}`);
    }
    setIsJoinModalOpen(false);
    setSelectedGroup(null);
  };

  return (
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      <div className={`${styles.headerBanner} ${styles.compactHeader}`}>
        <header className={styles.header}>
          {showSearch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', minHeight: '42px' }}>
              <button className={styles.headerSquareBtn} onClick={() => { setShowSearch(false); setSearchQuery(""); }} title="Close Search">
                <ArrowLeft size={20} />
              </button>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'transparent', borderRadius: '12px', padding: '0', border: 'none' }}>
                <input
                  type="text"
                  placeholder="Search groups..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.headerSearchInput}
                  style={{ flex: 1, border: 'none', background: 'transparent', color: 'white', padding: '0.5rem 0.5rem', outline: 'none', fontSize: '1rem' }}
                  autoFocus
                />
              </div>
            </div>
          ) : (
            <>
              <div className={styles.headerLeftGroup}>
                <button className={styles.headerSquareBtn} onClick={() => goBack('/campus')} title="Back to Campus">
                  <ArrowLeft size={20} />
                </button>
                <h1 className={styles.collegeTitle} style={{ margin: 0 }}>Campus Groups</h1>
              </div>
              <div className={styles.headerActions}>
                <button className={styles.headerSquareBtn} onClick={() => setShowSearch(true)} title="Search Groups">
                  <Search size={20} />
                </button>
                <button className={styles.headerSquareBtn} onClick={() => setIsCreateModalOpen(true)} title="Create Group">
                  <Plus size={20} />
                </button>
              </div>
            </>
          )}
        </header>
      </div>

      <div className={styles.campusBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: collegeGroups.length > 0 ? 'stretch' : 'center', justifyContent: collegeGroups.length > 0 ? 'flex-start' : 'center', padding: collegeGroups.length > 0 ? '0 1rem' : '2rem 1rem', textAlign: 'center' }}>
        {collegeGroups.length > 0 ? (
          <div className={styles.directoryGrid} style={{ textAlign: 'left' }}>
            {collegeGroups.map(group => (
              <div
                key={group.id}
                className={styles.directoryCard}
                onClick={() => handleGroupClick(group)}
              >
                <Avatar
                  src={group.avatar || (group.name ? group.name.substring(0, 2).toUpperCase() : 'GR')}
                  name={group.name}
                  size="56px"
                  isGroup={true}
                />
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '500', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {group.name}
                  </h4>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {group.desc || `${group.members || 1} ${(group.members || 1) === 1 ? 'member' : 'members'}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ fontSize: '4.5rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'center', alignItems: 'center', filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.2))' }}>🚀</div>
            <h2 style={{ margin: '0', color: 'var(--color-text-main)', fontSize: '1.5rem', fontWeight: '700', letterSpacing: '-0.02em' }}>Your Campus Needs Its First Group</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem', margin: '-0.75rem 0 1.25rem 0', maxWidth: '300px', lineHeight: 1.15 }}>Be the pioneer. Create a group around your shared interests.</p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              style={{
                background: 'var(--color-primary)',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '24px',
                fontWeight: '600',
                fontSize: '0.95rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                transition: 'transform 0.2s, box-shadow 0.2s',
                margin: '0 auto'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)'; }}
            >
              <Plus size={18} />
              Create Group
            </button>
          </>
        )}
      </div>

      {isCreateModalOpen && (
        <GroupCreationModal 
          onClose={() => setIsCreateModalOpen(false)} 
          onCreate={handleCreateGroup} 
          isDark={theme === 'dark'} 
        />
      )}

      {isJoinModalOpen && selectedGroup && (
        <div className={styles.modalOverlay} onClick={() => { setIsJoinModalOpen(false); setSelectedGroup(null); }}>
          <div className={styles.joinModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.joinAvatarWrapper}>
              <Avatar
                src={selectedGroup.avatar || (selectedGroup.name ? selectedGroup.name.substring(0, 2).toUpperCase() : 'GR')}
                name={selectedGroup.name}
                size="80px"
                isGroup={true}
              />
            </div>
            <h3 className={styles.joinGroupName}>{selectedGroup.name}</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', marginTop: '-0.75rem', marginBottom: '0.25rem' }}>
              {selectedGroup.members || 1} {(selectedGroup.members || 1) === 1 ? 'member' : 'members'}
            </p>
            {selectedGroup.desc && (
              <p className={styles.joinGroupDesc}>
                {selectedGroup.desc}
              </p>
            )}
            <div className={styles.joinModalButtons}>
              <button className={styles.joinPrimaryBtn} onClick={handleJoinConfirm}>
                {selectedGroup.whoCanJoin === 'Request required' ? 'Request to Join' : 'Join'}
              </button>
              <button className={styles.joinCancelBtn} onClick={() => { setIsJoinModalOpen(false); setSelectedGroup(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
