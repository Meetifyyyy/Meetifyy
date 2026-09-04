import { useState, useCallback, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';

import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './CampusCommunitiesPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import { Plus, Search, ArrowLeft } from '@shared/components/icons';
import CommunityCard from '@features/communities/components/card/CommunityCard';
import CommunityGrid from '@features/communities/components/card/CommunityGrid';
import { useCampusCommunities } from '@shared/hooks/useCommunities';
import { useDebounce } from '@shared/hooks/useDebounce';
import VerificationGate from '@shared/components/VerificationGate/VerificationGate';

/**
 * Reachable only from the "+" button or the empty state's CTA. Imported
 * statically it pulled the image-upload pipeline (browser-image-compression)
 * and a 700-line form onto this route's critical path — roughly 80 kB parsed
 * before the first community card could paint.
 */
const CreateCommunityModal = lazy(() => import('@features/communities/components/modals/CreateCommunityModal'));

export default function CampusCommunitiesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack();

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Name/description search runs on the server, across all campus communities.
  //
  // A `selectedCategory` filter used to sit on top of this. It could never do
  // anything: nothing ever called its setter, so it was permanently 'All', and
  // the field it filtered on — `c.categories` — is not a column on Community
  // and came back undefined for every row. Removed along with the memo that
  // recomputed it.
  const debouncedSearch = useDebounce(searchQuery, 300);
  const { campusCommunities: collegeCommunities } = useCampusCommunities(debouncedSearch);

  // Stable across renders. As an inline arrow per card this was a fresh prop on
  // every render of this page, which defeated CommunityCard's own React.memo
  // entirely — the grid re-rendered every card on each keystroke in the search
  // box and on every background refetch.
  const openCommunity = useCallback((id) => {
    navigate(`/communities/${id}`, { state: { from: location.pathname } });
  }, [navigate, location.pathname]);

  const openCreateModal = useCallback(() => setIsCreateModalOpen(true), []);
  const closeCreateModal = useCallback(() => setIsCreateModalOpen(false), []);

  return (
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      <VerificationGate message="Verify your student ID to access the campus directory, events, and communities." fullPage>
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
                  <h1 className={styles.collegeTitle} style={{ margin: 0 }}>
                    <span className={styles.desktopTitle}>Campus Communities</span>
                    <span className={styles.mobileTitle}>Communities</span>
                  </h1>
                </div>
                <div className={styles.headerActions}>
                  <button className={styles.headerSquareBtn} onClick={() => setShowSearch(true)} title="Search Communities">
                    <Search size={20} />
                  </button>
                  <button className={styles.headerSquareBtn} onClick={openCreateModal} title="Create Community">
                    <Plus size={20} />
                  </button>
                </div>
              </>
            )}
          </header>
        </div>

        <div className={styles.campusBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%', boxSizing: 'border-box' }}>
          {collegeCommunities.length > 0 ? (
            <CommunityGrid>
              {collegeCommunities.map(community => (
                <CommunityCard
                  key={community.id}
                  comm={community}
                  onSelect={openCommunity}
                />
              ))}
            </CommunityGrid>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              flex: 1,
              minHeight: 'calc(65vh - 100px)',
              padding: '2rem 1rem',
              boxSizing: 'border-box',
            }}>
              <div style={{
                fontSize: '3.25rem',
                lineHeight: 1,
                marginBottom: '0.4rem',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.15))'
              }}>
                🚀
              </div>
              <h2 style={{
                margin: '0 0 0.25rem 0',
                color: 'var(--color-text-main)',
                fontSize: '1.35rem',
                fontWeight: '700',
                letterSpacing: '-0.02em',
                textAlign: 'center',
                lineHeight: 1.25,
              }}>
                No Community
              </h2>
              <p style={{
                color: 'var(--color-text-muted)',
                fontSize: '0.88rem',
                margin: '0 0 1rem 0',
                textAlign: 'center',
                lineHeight: 1.35,
                maxWidth: '320px',
              }}>
                Your campus needs its first community
              </p>
              <button
                type="button"
                onClick={openCreateModal}
                style={{
                  background: 'var(--color-primary, #2563eb)',
                  color: 'white',
                  border: 'none',
                  padding: '0.65rem 1.35rem',
                  borderRadius: '24px',
                  fontWeight: '600',
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 4px 14px rgba(37, 99, 235, 0.25)',
                  transition: 'background 0.2s ease, opacity 0.2s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-primary-hover, #1d4ed8)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-primary, #2563eb)'; }}
              >
                <Plus size={16} />
                Create Community
              </button>
            </div>
          )}
        </div>

        {isCreateModalOpen && (
          <Suspense fallback={null}>
            <CreateCommunityModal
              onClose={closeCreateModal}
              onCreated={openCommunity}
              isCampusCommunity={true}
            />
          </Suspense>
        )}
      </VerificationGate>
    </main>
  );
}
