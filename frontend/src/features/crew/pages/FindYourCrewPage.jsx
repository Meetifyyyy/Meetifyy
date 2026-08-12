import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@shared/context/AuthContext';
import { useActivities, useCrewDiscover, useSavedActivitiesQuery, useMyActivitiesQuery } from '@shared/hooks/useCrew';
import { useDebounce } from '@shared/hooks/useDebounce';
import { prefetchActivity } from '@shared/hooks/prefetch';
import PageLayout from '@layout/PageLayout';
import PageHeader from '@layout/PageHeader';
import CrewCard from '../components/cards/CrewCard';
import CrewCardSkeleton from '../components/cards/CrewCardSkeleton';
import CreateActivityCard from '../components/cards/CreateActivityCard';
import CrewRightPanel from '../components/layout/CrewRightPanel';
import { mapActivity } from '@shared/utils/mapActivity';
import { filterActivities } from '@features/crew/utils/crewUtils';
import styles from './FindYourCrewPage.module.css';
import { useSavedActivitiesStore } from '@shared/stores/savedActivitiesStore';

// Small header row for a discovery section, with an optional "See All" link.
function SectionHeader({ title, onSeeAll }) {
  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
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

  const [selectedTab, setSelectedTab] = useState(location.state?.selectedTab || 'For You');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 200);

  // ── Discovery previews (For You: college + 1-on-1) ─────────────────────────
  const { collegeName: discCollegeName, college, oneOnOne } = useCrewDiscover();

  const hasCollege = Boolean(
    currentUser?.collegeId || currentUser?.college || currentUser?.university || currentUser?.campus,
  );
  // The dynamic college pill uses the authoritative name from discover, falling
  // back to the auth-derived name so the tab renders before discover resolves.
  const collegeTab = (discCollegeName || (hasCollege ? authCollegeName : null)) || null;

  const isCollegeTab = Boolean(collegeTab) && selectedTab === collegeTab;

  // ── Scoped feeds ───────────────────────────────────────────────────────────
  // Recent (public) always loads — it's the For You main list and the default.
  const recentFeed = useActivities('public');
  // Full college / 1-on-1 lists only fetch while their tab is active.
  const collegeFeed = useActivities('college', { enabled: isCollegeTab });
  const oneOnOneFeed = useActivities('one_on_one', { enabled: selectedTab === '1 on 1' });

  const { savedActivitiesData } = useSavedActivitiesQuery();
  const { myActivitiesData } = useMyActivitiesQuery();

  const savedActivities = useSavedActivitiesStore(state => state.savedActivities);
  const fetchSavedActivityIds = useSavedActivitiesStore(state => state.fetchSavedActivityIds);

  useEffect(() => {
    fetchSavedActivityIds();
  }, [fetchSavedActivityIds]);

  // ── Mapped lists ───────────────────────────────────────────────────────────
  const recentActivities = useMemo(
    () => filterActivities((recentFeed.activities || []).map(mapActivity).filter(Boolean), { search: debouncedSearchQuery }),
    [recentFeed.activities, debouncedSearchQuery],
  );
  const collegeActivities = useMemo(
    () => filterActivities((collegeFeed.activities || []).map(mapActivity).filter(Boolean), { search: debouncedSearchQuery }),
    [collegeFeed.activities, debouncedSearchQuery],
  );
  const oneOnOneActivities = useMemo(
    () => filterActivities((oneOnOneFeed.activities || []).map(mapActivity).filter(Boolean), { search: debouncedSearchQuery }),
    [oneOnOneFeed.activities, debouncedSearchQuery],
  );
  const collegePreview = useMemo(() => (college.items || []).map(mapActivity).filter(Boolean), [college.items]);
  const oneOnOnePreview = useMemo(() => (oneOnOne.items || []).map(mapActivity).filter(Boolean), [oneOnOne.items]);

  // Combined pool for Saved / My Activities tabs (secondary lists first so the
  // primary feed's optimistic patches win on ID collisions).
  const allCombinedActivities = useMemo(() => {
    const map = new Map();
    [...(savedActivitiesData || []), ...(myActivitiesData || []), ...(recentFeed.activities || [])].forEach(a => {
      if (a && a.id) map.set(a.id, a);
    });
    return Array.from(map.values()).map(mapActivity).filter(Boolean);
  }, [recentFeed.activities, savedActivitiesData, myActivitiesData]);

  // ── Saved tab list ─────────────────────────────────────────────────────────
  const savedList = useMemo(() => {
    if (selectedTab !== 'Saved') return [];
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
    if (selectedTab !== 'My Activities') {
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
  const activeFeed = isCollegeTab
    ? collegeFeed
    : selectedTab === '1 on 1'
      ? oneOnOneFeed
      : selectedTab === 'For You'
        ? recentFeed
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

  const loading = isCollegeTab
    ? collegeFeed.isLoading
    : selectedTab === '1 on 1'
      ? oneOnOneFeed.isLoading
      : recentFeed.isLoading;

  const hasActivities = useMemo(() => {
    if (selectedTab === 'My Activities') {
      return ongoingActivities.length > 0 || upcomingActivities.length > 0 || pastActivities.length > 0;
    }
    if (selectedTab === 'Saved') return savedList.length > 0;
    if (isCollegeTab) return collegeActivities.length > 0;
    if (selectedTab === '1 on 1') return oneOnOneActivities.length > 0;
    return recentActivities.length > 0 || collegePreview.length > 0 || oneOnOnePreview.length > 0;
  }, [selectedTab, isCollegeTab, ongoingActivities, upcomingActivities, pastActivities, savedList, collegeActivities, oneOnOneActivities, recentActivities, collegePreview, oneOnOnePreview]);

  const handleActivityClick = useCallback((activity) => {
    navigate(`/crew/${activity.id}`, { state: { activity, from: '/crew' } });
  }, [navigate]);

  const renderCards = (list) => list.map(a => (
    <CrewCard
      key={a.id}
      activity={a}
      onClick={() => handleActivityClick(a)}
      onMouseEnter={() => prefetchActivity(queryClient, a.id)}
    />
  ));

  const tabs = ['For You', ...(collegeTab ? [collegeTab] : []), '1 on 1', 'My Activities', 'Saved'];

  const searching = Boolean(searchQuery);

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
              {loading ? (
                <div className={styles.list}>
                  <CrewCardSkeleton />
                  <CrewCardSkeleton />
                  <CrewCardSkeleton />
                </div>
              ) : (
                <section className={styles.listSection}>
                  {/* ── For You: sectioned discovery ─────────────────────────── */}
                  {selectedTab === 'For You' && (
                    searching ? (
                      recentActivities.length > 0 ? (
                        <div className={styles.list}>{renderCards(recentActivities)}</div>
                      ) : (
                        <div className={styles.empty}>
                          <div className={styles.emptyEmoji}>🔍</div>
                          <h3 className={styles.emptyTitle}>No matching activities</h3>
                          <p className={styles.emptySubtitle}>Try searching for something else or clear your search query.</p>
                        </div>
                      )
                    ) : hasActivities ? (
                      <div className={styles.forYouWrapper}>
                        {collegePreview.length > 0 && (
                          <div className={styles.subSection}>
                            <SectionHeader
                              title={`From ${collegeTab || 'your college'}`}
                              onSeeAll={collegeTab ? () => setSelectedTab(collegeTab) : undefined}
                            />
                            <div className={styles.list}>{renderCards(collegePreview.slice(0, 2))}</div>
                          </div>
                        )}

                        {oneOnOnePreview.length > 0 && (
                          <div className={styles.subSection}>
                            <SectionHeader title="1-on-1" onSeeAll={() => setSelectedTab('1 on 1')} />
                            <div className={styles.list}>{renderCards(oneOnOnePreview.slice(0, 2))}</div>
                          </div>
                        )}

                        {recentActivities.length > 0 && (
                          <div className={styles.subSection}>
                            <SectionHeader title="Recent" />
                            <div className={styles.list}>{renderCards(recentActivities)}</div>
                            {recentFeed.hasNextPage && <div ref={sentinelRef} style={{ height: '1px', width: '100%' }} />}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={styles.centerCreateCardWrapper}>
                        <CreateActivityCard onCreateActivity={() => navigate('/crew/create')} />
                      </div>
                    )
                  )}

                  {/* ── College category tab ─────────────────────────────────── */}
                  {isCollegeTab && (
                    <>
                      <SectionHeader title={collegeTab} />
                      {collegeActivities.length > 0 ? (
                        <div className={styles.list}>{renderCards(collegeActivities)}</div>
                      ) : (
                        <EmptyOrSearch searching={searching} label="No college activities yet." />
                      )}
                      {collegeFeed.hasNextPage && <div ref={sentinelRef} style={{ height: '1px', width: '100%' }} />}
                    </>
                  )}

                  {/* ── 1-on-1 tab ───────────────────────────────────────────── */}
                  {selectedTab === '1 on 1' && (
                    <>
                      <SectionHeader title="1-on-1 Activities" />
                      {oneOnOneActivities.length > 0 ? (
                        <div className={styles.list}>{renderCards(oneOnOneActivities)}</div>
                      ) : (
                        <EmptyOrSearch searching={searching} label="No 1-on-1 activities yet." />
                      )}
                      {oneOnOneFeed.hasNextPage && <div ref={sentinelRef} style={{ height: '1px', width: '100%' }} />}
                    </>
                  )}

                  {/* ── Saved tab ────────────────────────────────────────────── */}
                  {selectedTab === 'Saved' && (
                    <>
                      <div className={styles.sectionHeader}>
                        <h2 className={styles.sectionTitle}>Saved Activities</h2>
                      </div>
                      {savedList.length > 0 ? (
                        <div className={styles.list}>{renderCards(savedList)}</div>
                      ) : (
                        <EmptyOrSearch searching={searching} label="No saved activities yet." />
                      )}
                    </>
                  )}

                  {/* ── My Activities tab ────────────────────────────────────── */}
                  {selectedTab === 'My Activities' && (
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
                showCreateCard={hasActivities}
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

// Shared empty state for list tabs — a search-aware message.
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
  return <div className={styles.subEmpty}>{label}</div>;
}
