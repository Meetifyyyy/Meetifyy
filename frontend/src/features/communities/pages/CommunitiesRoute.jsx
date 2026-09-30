import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search } from '@shared/components/icons';
import { useAuth } from '@shared/context/AuthContext';
import { openVerificationModal } from '@shared/stores/verificationModalStore';
import YourCommunities from '../components/directory/YourCommunities';
import ExploreCommunities from '../components/directory/ExploreCommunities';
import RightPanel from '@layout/RightPanel';
import CommunitiesAside from '../components/directory/CommunitiesAside';
import styles from './CommunitiesRoute.module.css';

const CreateCommunityModal = lazy(() => import('../components/modals/CreateCommunityModal'));

const SCROLL_KEY = 'meetifyy_communities_scrollY';

const TABS = [
  { id: 'yours', label: 'Yours' },
  { id: 'explore', label: 'Explore' },
];

/**
 * /communities — "Your communities" and "Explore".
 *
 * The tab lives in the URL (`?tab=explore`),
 * replaced rather than pushed, so back from a community returns to the same
 * view and a link can open Explore directly.
 */
export default function CommunitiesRoute() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);

  const tab = params.get('tab') === 'explore' ? 'explore' : 'yours';

  const update = useCallback((changes) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  const setTab = useCallback((id) => update({ tab: id === 'explore' ? 'explore' : '' }), [update]);
  const openExplore = useCallback(() => setTab('explore'), [setTab]);
  // Search is its own page. The scroll position is kept so Back from it lands
  // where the viewer left off rather than at the top.
  const openSearch = useCallback(() => {
    try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch { /* storage unavailable */ }
    navigate('/communities/search', { state: { fromCommunities: true } });
  }, [navigate]);

  useEffect(() => {
    let saved = null;
    try {
      saved = sessionStorage.getItem(SCROLL_KEY);
      sessionStorage.removeItem(SCROLL_KEY);
    } catch { /* storage unavailable */ }
    if (saved == null) return undefined;
    // The lists paint from cache on return; one frame lets them lay out first.
    const id = requestAnimationFrame(() => window.scrollTo(0, Number(saved) || 0));
    return () => cancelAnimationFrame(id);
  }, []);

  const openCreate = useCallback(() => {
    if (currentUser?.verificationStatus !== 'VERIFIED') {
      openVerificationModal('Verify your student ID to create a community.');
      return;
    }
    setShowCreate(true);
  }, [currentUser?.verificationStatus]);

  return (
    <>
      <main className={`centre animate-in ${styles.page}`}>
        <div className={styles.box}>
          <div className={styles.header}>
            <div className={styles.topBar}>
              <h1 className={styles.title}>Communities</h1>
              <div className={styles.topActions}>
                <button type="button" className={styles.iconBtn} onClick={openSearch} aria-label="Search communities">
                  <Search size={20} strokeWidth={2.5} />
                </button>
                <button type="button" className={`${styles.iconBtn} ${styles.iconBtnPrimary}`} onClick={openCreate} aria-label="Create community">
                  <Plus size={20} strokeWidth={2.75} />
                </button>
              </div>
            </div>
            <nav data-tab={tab} className={styles.tabs} role="tablist" aria-label="Communities">
              {TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          {tab === 'yours' ? (
            <YourCommunities onExplore={openExplore} onCreate={openCreate} />
          ) : (
            <ExploreCommunities
              onCreate={openCreate}
            />
          )}
        </div>
      </main>

      <RightPanel className="animate-in">
        <CommunitiesAside onCreate={openCreate} />
      </RightPanel>

      {showCreate && (
        <Suspense fallback={null}>
          <CreateCommunityModal
            onClose={() => setShowCreate(false)}
            onCreated={(id) => navigate(`/communities/${id}`)}
          />
        </Suspense>
      )}
    </>
  );
}
