import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useData } from '../../context/DataContext';
import CrewHeader from './CrewHeader';
import CrewCard from './CrewCard';
import CreateActivityModal from './CreateActivityModal';
import CrewRightPanel from './CrewRightPanel';
import { filterActivities } from './crewData';
import InstantMatchupCard from './InstantMatchupCard';
import InstantMatchFlow from './InstantMatchFlow';
import styles from './FindYourCrewPage.module.css';

export default function FindYourCrewPage() {
  const { crewActivities, addCrewActivity, currentUser, savedActivities } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(!crewActivities || crewActivities.length === 0);
  
  const [selectedTab, setSelectedTab] = useState(location.state?.selectedTab || 'For You');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isInstantMatchOpen, setIsInstantMatchOpen] = useState(false);
  const [initialActivityData, setInitialActivityData] = useState(null);
  const [visibleCount, setVisibleCount] = useState(3);

  useEffect(() => {
    if (crewActivities && crewActivities.length > 0) {
      setLoading(false);
    } else {
      const timer = setTimeout(() => setLoading(false), 600);
      return () => clearTimeout(timer);
    }
  }, [crewActivities]);

  const filteredActivities = useMemo(() => {
    if (!crewActivities) return [];
    
    const now = new Date();
    // Filter out past activities
    let activities = crewActivities.filter(a => {
      if (!a.date) return true;
      return new Date(a.date) > now;
    });

    // Filter by tab
    if (selectedTab === 'For You') {
      activities = activities.slice(0, 10);
    } else if (selectedTab === 'My Activities') {
      activities = activities.filter(a => 
        a.participants && a.participants.includes(currentUser?.id)
      ).sort((a, b) => new Date(a.dateLabel + ' 2024') - new Date(b.dateLabel + ' 2024'));
    } else if (selectedTab === 'Saved') {
      activities = activities.filter(a => savedActivities?.includes(a.id));
    } else if (selectedTab === 'Popular') {
      activities = [...activities].sort((a, b) => b.slotsFilled - a.slotsFilled).slice(0, 10);
    }

    return filterActivities(activities, { search: searchQuery });
  }, [crewActivities, searchQuery, selectedTab, currentUser, savedActivities]);

  const handleActivityClick = useCallback((activity) => {
    navigate(`/crew/${activity.id}`, { state: { activity } });
  }, [navigate]);

  return (
    <>
      <main className="centre centre-wide animate-in">
        <div className={styles.page}>
          
          <CrewHeader 
            selectedTab={selectedTab} 
            onTabChange={setSelectedTab}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onCreateActivity={() => {
              setInitialActivityData(null);
              setIsCreateModalOpen(true);
            }}
          />

          <div className={styles.layout}>
            <div className={styles.content}>
              {loading ? (
                <div className={styles.list}>
                  {[1, 2, 3].map(i => (
                    <div key={i} style={{ height: '140px', borderRadius: '16px', backgroundColor: 'var(--color-border-light)', animation: 'skeletonPulse 1.5s infinite' }} />
                  ))}
                </div>
              ) : (
                <>
                  {selectedTab === 'For You' && (
                    <InstantMatchupCard onFindMatch={() => setIsInstantMatchOpen(true)} />
                  )}
                  
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
                      <button className={styles.loadMoreBtn} onClick={() => setVisibleCount(p => p + 3)}>
                        Load More
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </button>
                    )}
                  </section>
                </>
              )}
            </div>
            
            <div className={styles.sidebarWrapper}>
              <CrewRightPanel 
                onCreateActivity={() => {
                  setInitialActivityData(null);
                  setIsCreateModalOpen(true);
                }}
                onViewAll={() => {
                  setSelectedTab('My Activities');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          </div>
          
        </div>
      </main>

      <CreateActivityModal 
        isOpen={isCreateModalOpen} 
        onClose={() => {
          setIsCreateModalOpen(false);
          setInitialActivityData(null);
        }} 
        initialData={initialActivityData}
        onSuccess={(newActivity) => {
          addCrewActivity(newActivity);
          setIsCreateModalOpen(false);
          setInitialActivityData(null);
        }}
      />
      
      <InstantMatchFlow 
        isOpen={isInstantMatchOpen} 
        onClose={() => setIsInstantMatchOpen(false)} 
        onCreateActivity={(data) => {
          setInitialActivityData(data);
          setIsInstantMatchOpen(false);
          setIsCreateModalOpen(true);
        }}
      />
    </>
  );
}
