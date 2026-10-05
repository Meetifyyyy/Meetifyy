import { useState, useCallback, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';

import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './CampusCommunitiesPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import { Plus, Search, ArrowLeft } from '@shared/components/icons';
import CommunityRow from '@features/communities/components/directory/CommunityRow';
import CommunityRowSkeleton from '@features/communities/components/directory/CommunityRowSkeleton';
import listStyles from '@features/communities/components/directory/CommunityList.module.css';
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

/**
 * Nothing to list. Two different situations, so two different messages:
 * a campus with no communities (the next step is to start one) and a search that
 * matched none (the next step is to search differently; creating a community is
 * not the answer to a typo).
 */
export function EmptyCommunities({ searching, query, onCreate }) {
  return (
    <div className={styles.emptyState}>
      <p className={styles.emptyEyebrow}>{searching ? 'Search' : 'Campus communities'}</p>
      <h2 className={styles.emptyTitle}>{searching ? 'No matches' : 'No communities yet'}</h2>
      <p className={styles.emptyText}>
        {searching
          ? <>Nothing on campus matches <span className={styles.emptyQuery}>{query}</span>.</>
          : 'Be the first to start one for your campus.'}
      </p>
      {!searching && (
        <button type="button" className={styles.emptyAction} onClick={onCreate}>
          <Plus size={16} />
          Create community
        </button>
      )}
    </div>
  );
}

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
  const { campusCommunities: collegeCommunities, isLoading } = useCampusCommunities(debouncedSearch);

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
          {collegeCommunities.length === 0 && isLoading ? (
            // Loading is not "No Community": rows the size of the real ones.
            <section className={listStyles.surface} aria-busy="true">
              <CommunityRowSkeleton count={5} />
            </section>
          ) : collegeCommunities.length > 0 ? (
            <section className={listStyles.surface}>
              <div className={listStyles.list}>
                {collegeCommunities.map(community => (
                  <CommunityRow
                    key={community.id}
                    community={community}
                    from={location.pathname}
                  />
                ))}
              </div>
            </section>
          ) : (
            <EmptyCommunities searching={Boolean(debouncedSearch.trim())} query={debouncedSearch.trim()} onCreate={openCreateModal} />
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
