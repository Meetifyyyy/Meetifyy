import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@shared/context/AuthContext';
import { useActivities, useCrewDiscover, useSavedActivitiesQuery, useMyActivitiesQuery } from '@shared/hooks/useCrew';
import { useDebounce } from '@shared/hooks/useDebounce';
import { useUrlState } from '@shared/hooks/useUrlState';
import { prefetchActivity } from '@shared/hooks/prefetch';
import PageLayout from '@layout/PageLayout';
import PageHeader from '@layout/PageHeader';
import CrewCard from '../components/cards/CrewCard';
import CrewCardSkeleton from '../components/cards/CrewCardSkeleton';
import InstantMatchCard from '../components/cards/InstantMatchCard';
import CrewRightPanel from '../components/layout/CrewRightPanel';
import { mapActivity } from '@shared/utils/mapActivity';
import { filterActivities } from '@features/crew/utils/crewUtils';
import {
  ALL_VIEWS,
  CREW_TAB_SLUGS,
  TAB_ALL,
  TAB_MINE,
  TAB_ONE_ON_ONE,
  TAB_SAVED,
  slugToTab,
  tabToSlug,
} from '@features/crew/utils/crewTabs';
import styles from './FindYourCrewPage.module.css';
import { useSavedActivitiesStore } from '@shared/stores/savedActivitiesStore';

// Small header row for a discovery section, with an optional "See All" link and
// an optional back affordance (used when a section is expanded in place).
function SectionHeader({ title, onSeeAll, onBack }) {
  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>
        {onBack && (
          <button type="button" className={styles.sectionBackBtn} onClick={onBack} aria-label="Back to all sections">
            <ChevronLeft size={18} />
          </button>
        )}
        {title}
      </h2>
      {onSeeAll && (
        <button type="button" className={styles.seeAllBtn} onClick={onSeeAll}>
          See All <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

export default function FindYourCrewPage() {
  const { currentUser, collegeName: authCollegeName } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  // The tab lives in the URL (?tab=saved), so a refresh, a shared link and the
  // Back button all agree on which list is showing. Slugs are fixed even though
  // the college pill's label is dynamic, so its address never shifts.
  const [tabSlug, setTabSlug] = useUrlState('tab', 'all', { allowed: CREW_TAB_SLUGS, push: true });
  const [allView, setAllView] = useUrlState('view', 'sections', { allowed: ALL_VIEWS, push: true });
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 200);

  // ── Discovery previews for the All tab (For You + college + 1-on-1) ────────
  const { collegeName: discCollegeName, forYou, college, oneOnOne, isLoading: discoverLoading } = useCrewDiscover();

  const hasCollege = Boolean(
    currentUser?.collegeId || currentUser?.college || currentUser?.university || currentUser?.campus,
  );
  // The dynamic college pill uses the authoritative name from discover, falling
  // back to the auth-derived name so the tab renders before discover resolves.
  const collegeTab = (discCollegeName || (hasCollege ? authCollegeName : null)) || null;

  const selectedTab = slugToTab(tabSlug, collegeTab);
  // Switching tabs always returns the All tab to its sectioned view, so the
  // "See all" state never leaks across tabs via the URL.
  const setSelectedTab = (tab) => {
    if (allView !== 'sections') setAllView('sections');
    setTabSlug(tabToSlug(tab, collegeTab));
  };

  const isCollegeTab = Boolean(collegeTab) && selectedTab === collegeTab;
  const isAllTab = selectedTab === TAB_ALL;
  const searching = Boolean(searchQuery);
  // The full ranked list: opened via "See all", and also used as the search pool
  // for the All tab so searching reaches past the five preview cards.
  const isForYouList = isAllTab && (allView === 'for-you' || searching);

  // ── Scoped feeds ───────────────────────────────────────────────────────────
  // Each full list fetches only while it is on screen; the All tab's three
  // strips come from the single composed discover request instead.
  const forYouFeed = useActivities('for_you', { enabled: isForYouList });
  const collegeFeed = useActivities('college', { enabled: isCollegeTab });
  const oneOnOneFeed = useActivities('one_on_one', { enabled: selectedTab === TAB_ONE_ON_ONE });

  const { savedActivitiesData } = useSavedActivitiesQuery();
  const { myActivitiesData } = useMyActivitiesQuery();

  const savedActivities = useSavedActivitiesStore(state => state.savedActivities);
  const fetchSavedActivityIds = useSavedActivitiesStore(state => state.fetchSavedActivityIds);

  useEffect(() => {
    fetchSavedActivityIds();
  }, [fetchSavedActivityIds]);

  // ── Mapped lists ───────────────────────────────────────────────────────────
  const forYouActivities = useMemo(
    () => filterActivities((forYouFeed.activities || []).map(mapActivity).filter(Boolean), { search: debouncedSearchQuery }),
    [forYouFeed.activities, debouncedSearchQuery],
  );
  const collegeActivities = useMemo(
    () => filterActivities((collegeFeed.activities || []).map(mapActivity).filter(Boolean), { search: debouncedSearchQuery }),
    [collegeFeed.activities, debouncedSearchQuery],
  );
  const oneOnOneActivities = useMemo(
    () => filterActivities((oneOnOneFeed.activities || []).map(mapActivity).filter(Boolean), { search: debouncedSearchQuery }),
    [oneOnOneFeed.activities, debouncedSearchQuery],
  );
  // The three All-tab strips. The server already de-duplicates across them and
  // caps each at five; this only maps them into card shape.
  const forYouPreview = useMemo(() => (forYou.items || []).map(mapActivity).filter(Boolean), [forYou.items]);
  const collegePreview = useMemo(() => (college.items || []).map(mapActivity).filter(Boolean), [college.items]);
  const oneOnOnePreview = useMemo(() => (oneOnOne.items || []).map(mapActivity).filter(Boolean), [oneOnOne.items]);

  // Searching on the All tab searches everything that tab can reach: the full
  // ranked list plus the three strips, de-duplicated by id.
  const allTabSearchResults = useMemo(() => {
    if (!searching) return [];
    const byId = new Map();
    [...forYouActivities, ...forYouPreview, ...collegePreview, ...oneOnOnePreview].forEach(a => {
      if (a?.id) byId.set(a.id, a);
    });
    return filterActivities(Array.from(byId.values()), { search: debouncedSearchQuery });
  }, [searching, forYouActivities, forYouPreview, collegePreview, oneOnOnePreview, debouncedSearchQuery]);

  // Combined pool for Saved / My Activities tabs (secondary lists first so the
  // primary feed's optimistic patches win on ID collisions).
  const allCombinedActivities = useMemo(() => {
    const map = new Map();
    [...(savedActivitiesData || []), ...(myActivitiesData || []), ...(forYouFeed.activities || [])].forEach(a => {
      if (a && a.id) map.set(a.id, a);
    });
    return Array.from(map.values()).map(mapActivity).filter(Boolean);
  }, [forYouFeed.activities, savedActivitiesData, myActivitiesData]);

  // ── Saved tab list ─────────────────────────────────────────────────────────
  const savedList = useMemo(() => {
    if (selectedTab !== TAB_SAVED) return [];
    const map = new Map();
    (savedActivitiesData || []).forEach(a => { if (a && a.id) map.set(a.id, a); });
    allCombinedActivities.forEach(a => {
      if (a && a.id && (savedActivities?.includes(a.id) || a.isBookmarked)) map.set(a.id, a);
    });
    const list = Array.from(map.values()).map(mapActivity).filter(Boolean);
    return filterActivities(list, { search: debouncedSearchQuery });
  }, [selectedTab, savedActivitiesData, allCombinedActivities, savedActivities, debouncedSearchQuery]);

  // ── My Activities grouping ─────────────────────────────────────────────────
  const { ongoingActivities, upcomingActivities, pastActivities } = useMemo(() => {
    if (selectedTab !== TAB_MINE) {
      return { ongoingActivities: [], upcomingActivities: [], pastActivities: [] };
    }
    const mine = allCombinedActivities.filter(a =>
      a && (
        a.participants?.includes(currentUser?.id) ||
        a.isJoined ||
        a.myStatus === 'MEMBER' ||
        a.creatorId === currentUser?.id ||
        a.hostId === currentUser?.id ||
        a.members?.some(m => (m.userId || m.id || m.user?.id) === currentUser?.id)
      )
    );
    const filtered = filterActivities(mine, { search: debouncedSearchQuery });

    const now = new Date();
    const ongoing = [];
    const upcoming = [];
    const past = [];

    filtered.forEach(a => {
      let hasEnded = a.status === 'ENDED' || a.status === 'CANCELLED';
      let hasStarted = false;

      const startRaw = a.startDate || a.date || a.createdAt;
      const endRaw = a.endDate;

      if (startRaw) {
        const start = new Date(startRaw);
        if (!isNaN(start.getTime())) hasStarted = now >= start;
      }

      if (!hasEnded) {
        if (endRaw) {
          const end = new Date(endRaw);
          if (!isNaN(end.getTime()) && now >= end) hasEnded = true;
        } else if (startRaw) {
          const start = new Date(startRaw);
          if (!isNaN(start.getTime())) {
            let durationHours = 1;
            if (a.duration) {
              const match = String(a.duration).match(/(\d+)/);
              if (match) durationHours = parseInt(match[1], 10);
            }
            const calculatedEnd = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
            if (now >= calculatedEnd) hasEnded = true;
          }
        }
      }

      if (hasEnded) past.push(a);
      else if (hasStarted) ongoing.push(a);
      else upcoming.push(a);
    });

    return { ongoingActivities: ongoing, upcomingActivities: upcoming, pastActivities: past };
  }, [selectedTab, allCombinedActivities, currentUser, debouncedSearchQuery]);

  // ── Active feed for infinite scroll (For You Recent / College / 1-on-1) ─────
  // Which list the infinite-scroll sentinel drives. On the All tab only the
  // expanded For You list paginates — the three strips are fixed-size previews.
  const activeFeed = isCollegeTab
    ? collegeFeed
    : selectedTab === TAB_ONE_ON_ONE
      ? oneOnOneFeed
      : isForYouList
        ? forYouFeed
        : null;

  const sentinelRef = useRef(null);
  useEffect(() => {
    if (!sentinelRef.current || !activeFeed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && activeFeed.hasNextPage && !activeFeed.isFetchingNextPage) {
          activeFeed.fetchNextPage();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [activeFeed]);

  // While searching, never fall back to skeletons: matches from the already
  // loaded sections render immediately and the ranked list widens them when it
  // arrives.
  const loading = searching
    ? false
    : isCollegeTab
      ? collegeFeed.isLoading
      : selectedTab === TAB_ONE_ON_ONE
        ? oneOnOneFeed.isLoading
        : allView === 'for-you'
          ? forYouFeed.isLoading
          : discoverLoading;

  const hasActivities = useMemo(() => {
    if (selectedTab === TAB_MINE) {
      return ongoingActivities.length > 0 || upcomingActivities.length > 0 || pastActivities.length > 0;
    }
    if (selectedTab === TAB_SAVED) return savedList.length > 0;
    if (isCollegeTab) return collegeActivities.length > 0;
    if (selectedTab === TAB_ONE_ON_ONE) return oneOnOneActivities.length > 0;
    if (searching) return allTabSearchResults.length > 0;
    if (allView === 'for-you') return forYouActivities.length > 0;
    return forYouPreview.length > 0 || collegePreview.length > 0 || oneOnOnePreview.length > 0;
  }, [selectedTab, isCollegeTab, searching, allView, ongoingActivities, upcomingActivities, pastActivities, savedList, collegeActivities, oneOnOneActivities, allTabSearchResults, forYouActivities, forYouPreview, collegePreview, oneOnOnePreview]);

  // Keyed by id so the card can stay memoized: it receives one stable callback
  // for its whole lifetime instead of a fresh closure on every list render.
  // The activity object itself is looked up from the current cache at click
  // time, so the navigation state is never a stale capture.
  const activitiesById = useRef(new Map());
  activitiesById.current = useMemo(() => {
    const map = new Map();
    [
      ...forYouPreview, ...collegePreview, ...oneOnOnePreview,
      ...forYouActivities, ...collegeActivities, ...oneOnOneActivities,
      ...savedList, ...ongoingActivities, ...upcomingActivities, ...pastActivities,
      ...allTabSearchResults,
    ].forEach(a => { if (a?.id) map.set(a.id, a); });
    return map;
  }, [forYouPreview, collegePreview, oneOnOnePreview, forYouActivities, collegeActivities,
      oneOnOneActivities, savedList, ongoingActivities, upcomingActivities, pastActivities,
      allTabSearchResults]);

  const handleActivityClick = useCallback((activityId) => {
    const activity = activitiesById.current.get(activityId);
    navigate(`/crew/${activityId}`, { state: { activity, from: '/crew' } });
  }, [navigate]);

  const handleActivityHover = useCallback((activityId) => {
    prefetchActivity(queryClient, activityId);
  }, [queryClient]);

  const renderCards = (list) => list.map(a => (
    <CrewCard
      key={a.id}
      activity={a}
      onClick={handleActivityClick}
      onMouseEnter={handleActivityHover}
    />
  ));

  const tabs = [TAB_ALL, ...(collegeTab ? [collegeTab] : []), TAB_ONE_ON_ONE, TAB_MINE, TAB_SAVED];

  return (
    <>
      <PageLayout>
        <div className={styles.page}>
          <PageHeader
            title="Crew"
            subtitle="Discover activities and people to do them with."
            backPath="/home"
            searchProps={{
              value: searchQuery,
              onChange: (e) => setSearchQuery(e.target.value),
              placeholder: 'Search activities, sports, hangouts...',
            }}
            actions={
              <button
                type="button"
                className={styles.createIconBtn}
                onClick={() => navigate('/crew/create')}
                aria-label="Create Activity"
                title="Create Activity"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            }
            tabs={tabs}
            activeTab={selectedTab}
            onTabChange={setSelectedTab}
            tabVariant="pills"
          />

          <div className={styles.layout}>
            <div className={styles.content}>
              {/* Always the first thing in the column, on every tab and while
                  the list is still loading — the activity cards follow below. */}
              <InstantMatchCard />

              {loading ? (
                <div className={styles.list}>
                  <CrewCardSkeleton />
                  <CrewCardSkeleton />
                  <CrewCardSkeleton />
                </div>
              ) : (
                <section className={styles.listSection}>
                  {/* ── All: three-subsection discovery ──────────────────────── */}
                  {isAllTab && (
                    searching ? (
                      allTabSearchResults.length > 0 ? (
                        <div className={styles.list}>{renderCards(allTabSearchResults)}</div>
                      ) : (
                        <EmptyOrSearch searching label="" />
                      )
                    ) : allView === 'for-you' ? (
                      /* "See all" on For You — the full ranked list, in place. */
                      <>
                        <SectionHeader title="For You" onBack={() => setAllView('sections')} />
                        {forYouActivities.length > 0 ? (
                          <div className={styles.list}>{renderCards(forYouActivities)}</div>
                        ) : (
                          <div className={styles.subEmpty}>Nothing to recommend just yet.</div>
                        )}
                        {forYouFeed.hasNextPage && <div ref={sentinelRef} style={{ height: '1px', width: '100%' }} />}
                      </>
                    ) : hasActivities ? (
                      <div className={styles.forYouWrapper}>
                        {forYouPreview.length > 0 && (
                          <div className={styles.subSection}>
                            <SectionHeader
                              title="For You"
                              onSeeAll={forYou.hasMore ? () => setAllView('for-you') : undefined}
                            />
                            <div className={styles.list}>{renderCards(forYouPreview)}</div>
                          </div>
                        )}

                        {collegePreview.length > 0 && (
                          <div className={styles.subSection}>
                            <SectionHeader
                              title={`From ${collegeTab || 'Your College'}`}
                              onSeeAll={collegeTab ? () => setSelectedTab(collegeTab) : undefined}
                            />
                            <div className={styles.list}>{renderCards(collegePreview)}</div>
                          </div>
                        )}

                        {oneOnOnePreview.length > 0 && (
                          <div className={styles.subSection}>
                            <SectionHeader title="1-on-1" onSeeAll={() => setSelectedTab(TAB_ONE_ON_ONE)} />
                            <div className={styles.list}>{renderCards(oneOnOnePreview)}</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={styles.emptyAll}>
                        Nothing here yet. Start something above, or create an
                        activity for later.
                      </div>
                    )
                  )}

                  {/* ── College category tab ─────────────────────────────────── */}
                  {isCollegeTab && (
                    <>
                      {collegeActivities.length > 0 ? (
                        <div className={styles.list}>{renderCards(collegeActivities)}</div>
                      ) : (
                        <EmptyOrSearch
                          searching={searching}
                        />
                      )}
                      {collegeFeed.hasNextPage && <div ref={sentinelRef} style={{ height: '1px', width: '100%' }} />}
                    </>
                  )}

                  {/* ── 1-on-1 tab ───────────────────────────────────────────── */}
                  {selectedTab === TAB_ONE_ON_ONE && (
                    <>
                      {oneOnOneActivities.length > 0 ? (
                        <div className={styles.list}>{renderCards(oneOnOneActivities)}</div>
                      ) : (
                        <EmptyOrSearch
                          searching={searching}
                        />
                      )}
                      {oneOnOneFeed.hasNextPage && <div ref={sentinelRef} style={{ height: '1px', width: '100%' }} />}
                    </>
                  )}

                  {/* ── Saved tab ────────────────────────────────────────────── */}
                  {selectedTab === TAB_SAVED && (
                    <>
                      <div className={styles.sectionHeader}>
                        <h2 className={styles.sectionTitle}>Saved Activities</h2>
                      </div>
                      {savedList.length > 0 ? (
                        <div className={styles.list}>{renderCards(savedList)}</div>
                      ) : (
                        <EmptyOrSearch
                          searching={searching}
                          label="Nothing saved yet — bookmark an activity to find it here."
                        />
                      )}
                    </>
                  )}

                  {/* ── My Activities tab ────────────────────────────────────── */}
                  {selectedTab === TAB_MINE && (
                    <div className={styles.myActivitiesWrapper}>
                      <div className={styles.subSection}>
                        <h3 className={styles.subSectionTitle}>
                          <span className={styles.liveBadge} />
                          Ongoing Activities
                          <span className={styles.subSectionCount}>{ongoingActivities.length}</span>
                        </h3>
                        {ongoingActivities.length > 0 ? (
                          <div className={styles.list}>{renderCards(ongoingActivities)}</div>
                        ) : (
                          <div className={styles.subEmpty}>No ongoing activities right now.</div>
                        )}
                      </div>

                      <div className={styles.subSection}>
                        <h3 className={styles.subSectionTitle}>
                          Upcoming Activities
                          <span className={styles.subSectionCount}>{upcomingActivities.length}</span>
                        </h3>
                        {upcomingActivities.length > 0 ? (
                          <div className={styles.list}>{renderCards(upcomingActivities)}</div>
                        ) : (
                          <div className={styles.subEmpty}>No upcoming activities scheduled.</div>
                        )}
                      </div>

                      <div className={styles.subSection}>
                        <h3 className={styles.subSectionTitle}>
                          Past Activities
                          <span className={styles.subSectionCount}>{pastActivities.length}</span>
                        </h3>
                        {pastActivities.length > 0 ? (
                          <div className={styles.list}>{renderCards(pastActivities)}</div>
                        ) : (
                          <div className={styles.subEmpty}>No past activities yet.</div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeFeed?.isFetchingNextPage && (
                    <div className={styles.paginationSpinnerWrapper}>
                      <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '2.5px', borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
                    </div>
                  )}
                </section>
              )}
            </div>

            <div className={styles.sidebarWrapper}>
              <CrewRightPanel
                onCreateActivity={() => navigate('/crew/create')}
                onViewAll={() => {
                  setSelectedTab('My Activities');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          </div>
        </div>
      </PageLayout>
    </>
  );
}

// Shared empty state for list tabs. A search that matches nothing is a dead end
// and says so; a genuinely empty list just says so, because the Instant Match
// strip at the top of the column is already offering the way out of it.
function EmptyOrSearch({ searching, label }) {
  if (searching) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyEmoji}>🔍</div>
        <h3 className={styles.emptyTitle}>No matching activities</h3>
        <p className={styles.emptySubtitle}>Try searching for something else or clear your search query.</p>
      </div>
    );
  }
  return (
    <div className={styles.subEmpty}>
      {label || 'Nothing here yet.'}
    </div>
  );
}
