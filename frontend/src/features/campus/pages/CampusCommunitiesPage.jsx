import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';
import { communitiesApi } from '@shared/api/apiClient';

import { showToast } from '@shared/utils/toast';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './CampusCommunitiesPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import { Plus, Search, ArrowLeft } from 'lucide-react';
import CreateCommunityModal from '@features/communities/components/modals/CreateCommunityModal';
import CommunityCard from '@features/communities/components/card/CommunityCard';
import CommunityGrid from '@features/communities/components/card/CommunityGrid';
import { useCampusCommunities } from '@shared/hooks/useCommunities';

export default function CampusCommunitiesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();
  const { campusCommunities } = useCampusCommunities();
  
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

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

  const handleCreateCommunity = async (id) => {
    navigate(`/communities/${id}`, { state: { from: location.pathname } });
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

      <div className={styles.campusBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: collegeCommunities.length > 0 ? 'stretch' : 'center', justifyContent: collegeCommunities.length > 0 ? 'flex-start' : 'center', padding: collegeCommunities.length > 0 ? '0 1rem' : '2rem 1rem', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        {collegeCommunities.length > 0 ? (
          <CommunityGrid>
            {collegeCommunities.map(community => (
              <CommunityCard
                key={community.id}
                comm={community}
                onClick={() => navigate(`/communities/${community.id}`, { state: { from: location.pathname } })}
              />
            ))}
          </CommunityGrid>
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
    </main>
  );
}
