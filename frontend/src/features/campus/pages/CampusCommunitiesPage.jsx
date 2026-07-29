import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';
import { communitiesApi } from '@shared/api/apiClient';

import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './CampusCommunitiesPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import { Plus, Search, ArrowLeft, Users } from 'lucide-react';
import CreateCommunityModal from '@features/communities/components/modals/CreateCommunityModal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useData } from '@shared/hooks/useData';
import { useJoinCommunity } from '@features/communities/hooks/useJoinCommunity';

export default function CampusCommunitiesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { mutate: toggleJoin } = useJoinCommunity();

  const toggleJoinCampusGroup = (id) => {
    const isJoined = currentUser?.campusGroups?.map(String).includes(String(id));
    toggleJoin({ communityId: id, isJoined: !isJoined, currentUser });
  };

  const { createCampusGroup, requestToJoinGroup, campusCommunities } = useData();
  
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState(null);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  const userCollegeId = currentUser?.collegeId;

  const collegeCommunities = useMemo(() => {
    let list = campusCommunities;

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
  }, [campusCommunities, searchQuery, selectedCategory]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('Communities link copied! 🔗');
  };

  const handleToggleCommunity = (grpId) => {
    toggleJoinCampusGroup(grpId);
    showToast('Community preference updated! ✨');
  };

  const handleCreateCommunity = async (id) => {
    showToast('Community created successfully! 🚀');
    navigate(`/communities/${id}`, { state: { from: location.pathname } });
  };

  const handleCommunityClick = (community) => {
    const isMember = currentUser?.campusGroups?.map(String).includes(String(community.id));
    if (isMember) {
      navigate(`/messages/${community.id}`, { state: { from: location.pathname } });
    } else {
      setSelectedCommunity(community);
      setIsJoinModalOpen(true);
    }
  };

  const handleJoinConfirm = () => {
    if (!selectedCommunity) return;
    if (selectedCommunity.whoCanJoin === 'Request required') {
      requestToJoinGroup(selectedCommunity.id, currentUser?.id);
      showToast('Join request sent successfully! 📨');
    } else {
      toggleJoinCampusGroup(selectedCommunity.id);
      showToast('Joined community successfully! 🎉');
      navigate(`/messages/${selectedCommunity.id}`, { state: { from: location.pathname } });
    }
    setIsJoinModalOpen(false);
    setSelectedCommunity(null);
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
                  placeholder="Search communities..."
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
                <h1 className={styles.collegeTitle} style={{ margin: 0 }}>Campus Communities</h1>
              </div>
              <div className={styles.headerActions}>
                <button className={styles.headerSquareBtn} onClick={() => setShowSearch(true)} title="Search Communities">
                  <Search size={20} />
                </button>
                <button className={styles.headerSquareBtn} onClick={() => setIsCreateModalOpen(true)} title="Create Community">
                  <Plus size={20} />
                </button>
              </div>
            </>
          )}
        </header>
      </div>

      <div className={styles.campusBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: collegeCommunities.length > 0 ? 'stretch' : 'center', justifyContent: collegeCommunities.length > 0 ? 'flex-start' : 'center', padding: collegeCommunities.length > 0 ? '0 1rem' : '2rem 1rem', textAlign: 'center' }}>
        {collegeCommunities.length > 0 ? (
          <div className={styles.directoryGrid} style={{ textAlign: 'left' }}>
            {collegeCommunities.map(community => (
              <div
                key={community.id}
                className={styles.directoryCard}
                onClick={() => handleCommunityClick(community)}
              >
                <Avatar
                  src={community.avatar || (community.name ? community.name.substring(0, 2).toUpperCase() : 'CO')}
                  name={community.name}
                  size="56px"
                  isGroup={true}
                />
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '500', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {community.name}
                  </h4>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {community.desc || `${community.members || 1} ${(community.members || 1) === 1 ? 'member' : 'members'}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ fontSize: '4.5rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'center', alignItems: 'center', filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.2))' }}>🚀</div>
            <h2 style={{ margin: '0', color: 'var(--color-text-main)', fontSize: '1.5rem', fontWeight: '700', letterSpacing: '-0.02em' }}>Your Campus Needs Its First Community</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem', margin: '-0.75rem 0 1.25rem 0', maxWidth: '300px', lineHeight: 1.15 }}>Be the pioneer. Create a community around your shared interests.</p>
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
              Create Community
            </button>
          </>
        )}
      </div>

      {isCreateModalOpen && (
        <CreateCommunityModal 
          onClose={() => setIsCreateModalOpen(false)} 
          onCreated={handleCreateCommunity}
          isCampusCommunity={true}
        />
      )}

      {isJoinModalOpen && selectedCommunity && (
        <div className={styles.modalOverlay} onClick={() => { setIsJoinModalOpen(false); setSelectedCommunity(null); }}>
          <div className={styles.joinModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.joinAvatarWrapper}>
              <Avatar
                src={selectedCommunity.avatar || (selectedCommunity.name ? selectedCommunity.name.substring(0, 2).toUpperCase() : 'CO')}
                name={selectedCommunity.name}
                size="80px"
                isGroup={true}
              />
            </div>
            <h3 className={styles.joinGroupName}>{selectedCommunity.name}</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', marginTop: '-0.75rem', marginBottom: '0.25rem' }}>
              {selectedCommunity.members || 1} {(selectedCommunity.members || 1) === 1 ? 'member' : 'members'}
            </p>
            {selectedCommunity.desc && (
              <p className={styles.joinGroupDesc}>
                {selectedCommunity.desc}
              </p>
            )}
            <div className={styles.joinModalButtons}>
              <button className={styles.joinPrimaryBtn} onClick={handleJoinConfirm}>
                {selectedCommunity.whoCanJoin === 'Request required' ? 'Request to Join' : 'Join'}
              </button>
              <button className={styles.joinCancelBtn} onClick={() => { setIsJoinModalOpen(false); setSelectedCommunity(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
