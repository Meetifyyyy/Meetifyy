import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuth } from '@shared/context/AuthContext';
import { useActivities, useCampusActivities, useSavedActivitiesQuery, useMyActivitiesQuery } from '@shared/hooks/useCrew';
import { useDebounce } from '@shared/hooks/useDebounce';
import { prefetchActivity } from '@shared/hooks/prefetch';
import PageLayout from '@layout/PageLayout';
import PageHeader from '@layout/PageHeader';
import CrewCard from '../components/cards/CrewCard';
import CrewCardSkeleton from '../components/cards/CrewCardSkeleton';
import CrewRightPanel from '../components/layout/CrewRightPanel';
import { filterActivities } from '@features/crew/utils/crewUtils';
import styles from './FindYourCrewPage.module.css';
import { useSavedActivitiesStore } from '@shared/stores/savedActivitiesStore';

export default function FindYourCrewPage() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();

  // Feature-scoped hooks — no more duplicate queries
  const {
    activities: rawActivities,
    isLoading: loading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useActivities();
  const { campusActivities: rawCampusActivities } = useCampusActivities();
  const { savedActivitiesData } = useSavedActivitiesQuery();
  const { myActivitiesData } = useMyActivitiesQuery();

  const mapActivity = (a) => {
    if (!a || typeof a !== 'object') return null;
    return {
      ...a,
      hostId: a.creatorId,
      hostName: a.creator?.displayName || a.members?.find(m => m?.userId === a.creatorId)?.user?.displayName || 'Host',
      hostUsername: a.creator?.username || a.members?.find(m => m?.userId === a.creatorId)?.user?.username || 'host',
      hostAvatar: a.creator?.avatar || a.members?.find(m => m?.userId === a.creatorId)?.user?.avatar || '',
      participants: a.members?.filter(m => m?.status === 'MEMBER').map(m => m?.userId).filter(Boolean) || [],
      pendingRequests: a.members?.filter(m => m?.status === 'PENDING').map(m => m?.userId).filter(Boolean) || [],
      slotsFilled: a.members?.filter(m => m?.status === 'MEMBER').length || 1,
      slotsNeeded: a.maxMembers || 999,
      _membersData: a.members?.map(m => m?.user).filter(Boolean) || [],
    };
  };

  const crewActivities = useMemo(() => (rawActivities || []).map(mapActivity).filter(Boolean), [rawActivities]);

  const allCombinedActivities = useMemo(() => {
    const map = new Map();
    [...(rawActivities || []), ...(rawCampusActivities || []), ...(savedActivitiesData || []), ...(myActivitiesData || [])].forEach(a => {
      if (a && a.id) map.set(a.id, a);
    });
    return Array.from(map.values()).map(mapActivity).filter(Boolean);
  }, [rawActivities, rawCampusActivities, savedActivitiesData, myActivitiesData]);

  const savedActivities = useSavedActivitiesStore(state => state.savedActivities);
  const fetchSavedActivityIds = useSavedActivitiesStore(state => state.fetchSavedActivityIds);
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedTab, setSelectedTab] = useState(location.state?.selectedTab || 'For You');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 200);

  useEffect(() => {
    fetchSavedActivityIds();
  }, [fetchSavedActivityIds]);

  // IntersectionObserver sentinel — triggers fetchNextPage instead of visibleCount++
  const sentinelRef = useRef(null);
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '400px' } // Start fetching 400px before the user reaches the bottom
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filteredActivities = useMemo(() => {
    if (!crewActivities) return [];

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Helper: has activity started?
    const isActivityStarted = (a) => {
      if (!a) return false;
      const status = (a.status || '').toUpperCase();
      if (status === 'ENDED' || status === 'CANCELLED' || status === 'CLOSED' || status === 'COMPLETED') return true;
      const now = new Date();
      const startRaw = a.startDate || a.date || a.createdAt;
      if (startRaw && new Date(startRaw) <= now) return true;
      if (a.endDate && new Date(a.endDate) <= now) return true;
      return false;
    };

    // Helper: is this activity public ("Anyone")?
    const isPublicActivity = (a) => {
      if (!a) return false;
      const vis = String(a.visibility || '').toUpperCase();
      if (vis === 'PRIVATE' || vis === 'COLLEGE_ONLY' || vis === 'COLLEGE' || vis === 'SCHOOL' || vis === 'CAMPUS') return false;
      if (vis === 'PUBLIC') return true;
      if (a.isCollegeOnly === true) return false;
      const join = String(a.whoCanJoin || '').toLowerCase();
      if (join === 'college' || join === 'school' || join === 'campus' || join === 'no one') return false;
      return true;
    };

    // Saved tab: show ALL activities saved/bookmarked by the user regardless of visibility or status
    if (selectedTab === 'Saved') {
      const map = new Map();
      (savedActivitiesData || []).forEach(a => { if (a && a.id) map.set(a.id, a); });
      allCombinedActivities.forEach(a => {
        if (a && a.id && (savedActivities?.includes(a.id) || a.isBookmarked)) {
          map.set(a.id, a);
        }
      });
      const savedList = Array.from(map.values()).map(mapActivity).filter(Boolean);
      return filterActivities(savedList, { search: debouncedSearchQuery });
    }

    // "My Activities" — show ALL activities the user is part of (created or joined), regardless of visibility.
    if (selectedTab === 'My Activities') {
      const mine = allCombinedActivities.filter(a =>
        a && (
          a.participants?.includes(currentUser?.id) ||
          a.isJoined ||
          a.myStatus === 'MEMBER' ||
          a.creatorId === currentUser?.id ||
          a.hostId === currentUser?.id ||
          a.members?.some(m => (m.userId || m.id || m.user?.id) === currentUser?.id)
        )
      ).sort((a, b) => new Date(a.startDate || a.date || a.createdAt || 0) - new Date(b.startDate || b.date || b.createdAt || 0));
      return filterActivities(mine, { search: debouncedSearchQuery });
    }

    // Public tabs ("For You", "1 on 1"): ONLY show PUBLIC ("Anyone") activities
    let activities = crewActivities.filter(a => isPublicActivity(a));

    // Exclude started/past activities from public-facing tabs
    activities = activities.filter(a => !isActivityStarted(a));

    if (selectedTab === 'For You') {
      if (!searchQuery) activities = activities.slice(0, 10);
    } else if (selectedTab === '1 on 1' || selectedTab === 'Popular') {
      activities = activities.filter(a => {
        const limit = Number(a.maxMembers || a.slotsNeeded || a.maxParticipants || 0);
        return limit === 2;
      });
    }

    return filterActivities(activities, { search: debouncedSearchQuery });
  }, [crewActivities, allCombinedActivities, debouncedSearchQuery, selectedTab, currentUser, savedActivities, searchQuery]);

  const { ongoingActivities, upcomingActivities, pastActivities } = useMemo(() => {
    if (selectedTab !== 'My Activities') {
      return { ongoingActivities: [], upcomingActivities: [], pastActivities: [] };
    }
    const now = new Date();
    const ongoing = [];
    const upcoming = [];
    const past = [];

    filteredActivities.forEach(a => {
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
  }, [filteredActivities, selectedTab]);

  const handleActivityClick = useCallback((activity) => {
    navigate(`/crew/${activity.id}`, { state: { activity, from: '/crew' } });
  }, [navigate]);

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
            tabs={['For You', '1 on 1', 'My Activities', 'Saved']}
            activeTab={selectedTab === 'Popular' ? '1 on 1' : selectedTab}
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
                <>
                  <section className={styles.listSection}>
                    {selectedTab !== 'For You' && selectedTab !== 'My Activities' && (
                      <div className={styles.sectionHeader}>
                        <h2 className={styles.sectionTitle}>
                          {selectedTab === 'Saved' ? 'Saved Activities' : 
                           (selectedTab === '1 on 1' || selectedTab === 'Popular') ? '1 on 1 Activities' : 'Activities'}
                        </h2>
                      </div>
                    )}
                    
                    {selectedTab === 'My Activities' ? (
                      <div className={styles.myActivitiesWrapper}>
                        {/* Ongoing Section */}
                        <div className={styles.subSection}>
                          <h3 className={styles.subSectionTitle}>
                            <span className={styles.liveBadge} />
                            Ongoing Activities
                            <span className={styles.subSectionCount}>{ongoingActivities.length}</span>
                          </h3>
                          {ongoingActivities.length > 0 ? (
                            <div className={styles.list}>
                              {ongoingActivities.map(a => <CrewCard key={a.id} activity={a} onClick={() => handleActivityClick(a)} />)}
                            </div>
                          ) : (
                            <div className={styles.subEmpty}>No ongoing activities right now.</div>
                          )}
                        </div>

                        {/* Upcoming Section */}
                        <div className={styles.subSection}>
                          <h3 className={styles.subSectionTitle}>
                            Upcoming Activities
                            <span className={styles.subSectionCount}>{upcomingActivities.length}</span>
                          </h3>
                          {upcomingActivities.length > 0 ? (
                            <div className={styles.list}>
                              {upcomingActivities.map(a => <CrewCard key={a.id} activity={a} onClick={() => handleActivityClick(a)} />)}
                            </div>
                          ) : (
                            <div className={styles.subEmpty}>No upcoming activities scheduled.</div>
                          )}
                        </div>

                        {/* Past Section */}
                        <div className={styles.subSection}>
                          <h3 className={styles.subSectionTitle}>
                            Past Activities
                            <span className={styles.subSectionCount}>{pastActivities.length}</span>
                          </h3>
                          {pastActivities.length > 0 ? (
                            <div className={styles.list}>
                              {pastActivities.map(a => <CrewCard key={a.id} activity={a} onClick={() => handleActivityClick(a)} />)}
                            </div>
                          ) : (
                            <div className={styles.subEmpty}>No past activities yet.</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className={styles.list}>
                        {filteredActivities.length > 0 ? (
                          filteredActivities.map(a => (
                            <CrewCard
                              key={a.id}
                              activity={a}
                              onClick={() => handleActivityClick(a)}
                              onMouseEnter={() => prefetchActivity(queryClient, a.id)}
                            />
                          ))
                        ) : (
                          <div className={styles.empty}>
                            <div className={styles.emptyEmoji}>
                              {searchQuery ? '🔍' : selectedTab === '1 on 1' ? '🤝' : selectedTab === 'Saved' ? '🔖' : '✨'}
                            </div>
                            <h3 className={styles.emptyTitle}>
                              {searchQuery
                                ? 'No matching activities'
                                : selectedTab === '1 on 1'
                                ? 'No 1-on-1 hangouts yet'
                                : selectedTab === 'Saved'
                                ? 'No saved activities'
                                : 'No activities right now'}
                            </h3>
                            <p className={styles.emptySubtitle}>
                              {searchQuery
                                ? 'Try searching for something else or clear your search query.'
                                : selectedTab === '1 on 1'
                                ? 'Create a 2-person activity to connect with someone one-on-one!'
                                : selectedTab === 'Saved'
                                ? 'Bookmark activities you like to easily find them here.'
                                : 'Be the first to spark an activity and gather your crew!'}
                            </p>
                            <button
                              type="button"
                              className={styles.mobileCreateBtn}
                              onClick={() => navigate('/crew/create')}
                            >
                              <Plus size={18} />
                              Create Activity
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {selectedTab !== 'My Activities' && hasNextPage && (
                      <div ref={sentinelRef} style={{ height: '1px', width: '100%' }} />
                    )}
                    {isFetchingNextPage && (
                      <div className={styles.paginationSpinnerWrapper}>
                        <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '2.5px', borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
                      </div>
                    )}
                  </section>
                </>
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
