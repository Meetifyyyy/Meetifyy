import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search } from '@shared/components/icons';
import { useAuth } from '@shared/context/AuthContext';
import { openVerificationModal } from '@shared/stores/verificationModalStore';
import YourCommunities from '../components/directory/YourCommunities';
import ExploreCommunities from '../components/directory/ExploreCommunities';
import RightPanel from '@layout/RightPanel';
import CommunitiesAside from '../components/directory/CommunitiesAside';
import styles from './CommunitiesRoute.module.css';
import { useWhiteSurface } from '@shared/hooks/useWhiteSurface';
import { settleAfter, useTabSwipe } from '../hooks/useTabSwipe';

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
 *
 * The two views are panes side by side. Choosing a tab slides to the other
 * pane, and a sideways swipe on the content drags them (hooks/useTabSwipe);
 * the indicator under the tabs follows both. At rest only the active pane is in
 * the page, so the page is as tall as that pane and nothing else.
 */
export default function CommunitiesRoute() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  // Light theme on a phone: white behind the page, not the blue gradient.
  useWhiteSurface();

  const tab = params.get('tab') === 'explore' ? 'explore' : 'yours';
  const tabIndex = TABS.findIndex((t) => t.id === tab);

  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const tabsRef = useRef(null);
  const settleTimer = useRef(0);
  const prevTab = useRef(tab);
  // Explore is built the first time it is wanted (opened, or a swipe towards it
  // starts) and kept after, so it does not load for someone who never goes there.
  const [exploreWanted, setExploreWanted] = useState(tab === 'explore');
  const exploreMounted = exploreWanted || tab === 'explore';

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

  const swipeCommitted = useTabSwipe({
    viewportRef,
    trackRef,
    tabsRef,
    index: tabIndex,
    count: TABS.length,
    timer: settleTimer,
    onStart: () => setExploreWanted(true),
    onCommit: (i) => setTab(TABS[i].id),
  });

  // Choosing a tab (a tap, a link, Back) slides to its pane. A swipe has already
  // started the slide from where the finger let go, so it is only left to finish.
  useLayoutEffect(() => {
    const from = TABS.findIndex((t) => t.id === prevTab.current);
    prevTab.current = tab;
    const track = trackRef.current;
    const tabs = tabsRef.current;
    if (!track || from === tabIndex) return;
    if (swipeCommitted.current) {
      swipeCommitted.current = false;
      return;
    }
    window.clearTimeout(settleTimer.current);
    track.dataset.moving = '1';
    track.style.transition = 'none';
    track.style.setProperty('--drag', '0px');
    track.style.setProperty('--tab-index', String(from));
    tabs?.style.setProperty('--tab-progress', String(from));
    void track.offsetWidth; // the start position takes hold before the slide
    track.style.transition = '';
    track.style.setProperty('--tab-index', String(tabIndex));
    tabs?.style.setProperty('--tab-progress', String(tabIndex));
    settleAfter(settleTimer, track, tabs);
  }, [tab, tabIndex, swipeCommitted]);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);
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
      openVerificationModal('Verify with a live selfie to create a community.');
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
            <nav ref={tabsRef} data-tab={tab} className={styles.tabs} role="tablist" aria-label="Communities">
              {TABS.map(({ id, label }) => (
                <button
                  key={id}
                  id={`communities-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`communities-pane-${id}`}
                  className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div ref={viewportRef} className={styles.viewport}>
            <div ref={trackRef} className={styles.track}>
              <section
                id="communities-pane-yours"
                role="tabpanel"
                aria-labelledby="communities-tab-yours"
                data-active={tab === 'yours'}
                className={styles.pane}
              >
                <YourCommunities />
              </section>
              {exploreMounted ? (
                <section
                  id="communities-pane-explore"
                  role="tabpanel"
                  aria-labelledby="communities-tab-explore"
                  data-active={tab === 'explore'}
                  className={styles.pane}
                >
                  <ExploreCommunities />
                </section>
              ) : null}
            </div>
          </div>
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
