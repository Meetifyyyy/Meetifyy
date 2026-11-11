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
import { refuseOffline } from '@shared/lib/offlineGuard';

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
  // Each tab keeps its own scroll position. The window scrolls for both, so the
  // position is remembered per tab and put back when its tab is chosen.
  const scrollByTab = useRef({ yours: 0, explore: 0 });
  const activeTabRef = useRef(tab);
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
    onStart: () => {
      setExploreWanted(true);
      // The pane coming in is shown at ITS OWN scroll position from the first
      // frame of the drag (each tab keeps its own, scrollByTab), not at this
      // one's: the window is still scrolled for the current tab, so the other
      // pane is offset by the difference. When the swipe commits, the window
      // takes that pane's position and the offset goes, with nothing moving
      // on screen. It used to slide in at the wrong height and then jump.
      const track = trackRef.current;
      const other = TABS.find((t) => t.id !== activeTabRef.current);
      if (track && other) {
        const peek = window.scrollY - (scrollByTab.current[other.id] ?? 0);
        track.style.setProperty('--leave-shift', `${peek}px`);
      }
    },
    onCommit: (i) => setTab(TABS[i].id),
  });

  // Choosing a tab (a tap, a link, Back) slides to its pane. A swipe has already
  // started the slide from where the finger let go, so it is only left to finish.
  useEffect(() => {
    const onScroll = () => { scrollByTab.current[activeTabRef.current] = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    const fromId = prevTab.current;
    const from = TABS.findIndex((t) => t.id === fromId);
    prevTab.current = tab;
    activeTabRef.current = tab;
    const track = trackRef.current;
    const tabs = tabsRef.current;
    if (!track || from === tabIndex) return;

    // Back to where this tab was left. Both panes are shown (so the page is tall
    // enough), and the pane being left is shifted so it does not move on screen.
    const shift = scrollByTab.current[tab] - scrollByTab.current[fromId];
    track.dataset.moving = '1';
    track.dataset.reset = '1';
    track.style.setProperty('--leave-shift', `${shift}px`);
    // 0 for a swipe too: the drag already showed the incoming pane at this
    // tab's own scroll position (see onStart), so it has nothing to ease from.
    track.style.setProperty('--enter-shift', '0px');
    window.scrollTo({ top: scrollByTab.current[tab], behavior: 'instant' });
    void track.offsetWidth;
    delete track.dataset.reset;
    track.style.setProperty('--enter-shift', '0px');
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
    if (refuseOffline()) return;
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
