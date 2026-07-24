import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@shared/context/AuthContext';
import { activitiesApi } from '@shared/api/apiClient';
import { useDebounce } from '@shared/hooks/useDebounce';
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
  const { data: rawActivities = [], isLoading: loading } = useQuery({
    queryKey: ['activities'],
    queryFn: activitiesApi.getAll,
  });

  const crewActivities = useMemo(() => {
    return rawActivities.map(a => ({
      ...a,
      hostId: a.creatorId,
      hostName: a.members?.find(m => m.userId === a.creatorId)?.user?.displayName || 'Host',
      hostUsername: a.members?.find(m => m.userId === a.creatorId)?.user?.username || 'host',
      hostAvatar: a.members?.find(m => m.userId === a.creatorId)?.user?.avatar || '',
      participants: a.members?.filter(m => m.status === 'MEMBER').map(m => m.userId) || [],
      pendingRequests: a.members?.filter(m => m.status === 'PENDING').map(m => m.userId) || [],
      slotsFilled: a.members?.filter(m => m.status === 'MEMBER').length || 1,
      slotsNeeded: a.maxMembers || 999,
      _membersData: a.members?.map(m => m.user) || []
    }));
  }, [rawActivities]);
  const savedActivities = useSavedActivitiesStore(state => state.savedActivities);
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedTab, setSelectedTab] = useState(location.state?.selectedTab || 'For You');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 200);
  const [visibleCount, setVisibleCount] = useState(3);

  const observer = useRef(null);
  const lastElementRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setVisibleCount(prev => prev + 3);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading]);

  const filteredActivities = useMemo(() => {
    if (!crewActivities) return [];
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Filter out past activities based on date (ignoring time so today's aren't filtered out)
    let activities = crewActivities.filter(a => {
      if (!a.date) return true;
      const activityDate = new Date(a.date);
      activityDate.setHours(0, 0, 0, 0);
      return activityDate >= today;
    }).filter(a => !a.shareToSchool || a.hostCollege === (currentUser?.college?.name || currentUser?.college)); 

    // Filter by tab
    if (selectedTab === 'For You') {
      if (!searchQuery) {
        activities = activities.slice(0, 10);
      }
    } else if (selectedTab === 'My Activities') {
      activities = activities.filter(a => 
        a.participants && a.participants.includes(currentUser?.id)
      ).sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    } else if (selectedTab === 'Saved') {
      activities = activities.filter(a => savedActivities?.includes(a.id));
    } else if (selectedTab === 'Popular') {
      activities = [...activities].sort((a, b) => b.slotsFilled - a.slotsFilled);
      if (!debouncedSearchQuery) {
        activities = activities.slice(0, 10);
      }
    }

    return filterActivities(activities, { search: debouncedSearchQuery });
  }, [crewActivities, debouncedSearchQuery, selectedTab, currentUser, savedActivities]);

  const handleActivityClick = useCallback((activity) => {
    navigate(`/crew/${activity.id}`, { state: { activity } });
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
            tabs={['For You', 'Popular', 'My Activities', 'Saved']}
            activeTab={selectedTab}
            onTabChange={setSelectedTab}
            tabVariant="underline"
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
                    {selectedTab !== 'For You' && (
                      <div className={styles.sectionHeader}>
                        <h2 className={styles.sectionTitle}>
                          {selectedTab === 'My Activities' ? 'My Activities' : 
                           selectedTab === 'Saved' ? 'Saved Activities' : 
                           selectedTab === 'Popular' ? 'Most Popular' : 'Activities'}
                        </h2>
                      </div>
                    )}
                    
                    <div className={styles.list}>
                      {filteredActivities.length > 0 ? (
                        filteredActivities.slice(0, visibleCount).map(a => <CrewCard key={a.id} activity={a} onClick={() => handleActivityClick(a)} />)
                      ) : (
                        <div className={styles.empty}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                          <p>No activities match your search.</p>
                        </div>
                      )}
                    </div>
                    
                    {filteredActivities.length > visibleCount && (
                      <div ref={lastElementRef} style={{ height: '20px', width: '100%', margin: '1rem 0' }}></div>
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
