import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { Bookmark, List, Grid, Calendar, FileText } from 'lucide-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { postsApi, activitiesApi } from '@shared/api/apiClient';
import Post from '../components/post/Post';
import CrewCard from '@features/crew/components/cards/CrewCard';
import CrewCardSkeleton from '@features/crew/components/cards/CrewCardSkeleton';
import Avatar from '@shared/components/avatar/Avatar';
import styles from './SavedPage.module.css';
import { useData } from '@shared/hooks/useData';
import { useSavedActivitiesStore } from '@shared/stores/savedActivitiesStore';

export default function SavedPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { getUserById } = useData();
  const [activeTab, setActiveTab] = useState('activities'); // 'activities' | 'posts'

  const savedActivities = useSavedActivitiesStore(state => state.savedActivities);
  const fetchSavedActivityIds = useSavedActivitiesStore(state => state.fetchSavedActivityIds);

  useEffect(() => {
    fetchSavedActivityIds();
  }, [fetchSavedActivityIds]);

  // Posts infinite query
  const {
    data: postsData,
    fetchNextPage: fetchNextPostsPage,
    hasNextPage: hasNextPostsPage,
    isFetchingNextPage: isFetchingNextPostsPage,
    isLoading: isPostsLoading
  } = useInfiniteQuery({
    queryKey: ['bookmarks'],
    queryFn: async ({ pageParam = undefined }) => {
      const res = await postsApi.getBookmarks(20, pageParam);
      return res;
    },
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
  });

  // Saved Activities infinite query from backend
  const {
    data: activitiesData,
    fetchNextPage: fetchNextActivitiesPage,
    hasNextPage: hasNextActivitiesPage,
    isFetchingNextPage: isFetchingNextActivitiesPage,
    isLoading: isActivitiesLoading
  } = useInfiniteQuery({
    queryKey: ['savedActivitiesQuery'],
    queryFn: async ({ pageParam = undefined }) => {
      const res = await activitiesApi.getBookmarks(10, pageParam);
      return res;
    },
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
  });

  // Query all raw activities as fallback for locally bookmarked items
  const { data: rawActivities = [] } = useQuery({
    queryKey: ['activities'],
    queryFn: activitiesApi.getAll,
    staleTime: 30_000,
  });
  const { data: rawCampusActivities = [] } = useQuery({
    queryKey: ['campusActivities'],
    queryFn: activitiesApi.getCampusActivities,
    staleTime: 30_000,
  });

  const fullPosts = postsData?.pages.flatMap(page => page.posts || []) ?? [];

  // Backend returned saved activities
  const backendSavedActivities = activitiesData?.pages.flatMap(page => page.activities || []) ?? [];

  // Combine backend saved activities with local savedActivitiesStore fallback list
  const fullSavedActivities = (() => {
    const actMap = new Map();
    // Add backend saved activities
    backendSavedActivities.forEach(a => {
      if (a && a.id) actMap.set(a.id, a);
    });
    // Add any raw/campus activity that is in savedActivities array
    [...(rawActivities || []), ...(rawCampusActivities || [])].forEach(a => {
      if (a && a.id && savedActivities?.includes(a.id) && !actMap.has(a.id)) {
        actMap.set(a.id, a);
      }
    });
    return Array.from(actMap.values()).map(a => ({
      ...a,
      hostId: a.creatorId || a.hostId,
      hostName: a.hostName || a.creator?.displayName || a.members?.find(m => m.userId === a.creatorId)?.user?.displayName || 'Host',
      hostUsername: a.hostUsername || a.creator?.username || a.members?.find(m => m.userId === a.creatorId)?.user?.username || 'host',
      hostAvatar: a.hostAvatar || a.creator?.avatar || a.members?.find(m => m.userId === a.creatorId)?.user?.avatar || '',
      participants: a.participants || a.members?.filter(m => m.status === 'MEMBER').map(m => m.userId) || [],
      pendingRequests: a.pendingRequests || a.members?.filter(m => m.status === 'PENDING').map(m => m.userId) || [],
      slotsFilled: a.slotsFilled || a.members?.filter(m => m.status === 'MEMBER').length || 1,
      slotsNeeded: a.slotsNeeded || a.maxMembers || 999,
      _membersData: a._membersData || a.members?.map(m => m.user) || []
    }));
  })();

  const loadMoreRef = useRef(null);

  // IntersectionObserver for pagination / infinite scroll
  useEffect(() => {
    if (activeTab === 'posts') {
      if (!hasNextPostsPage || isPostsLoading || isFetchingNextPostsPage) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) fetchNextPostsPage();
        },
        { threshold: 0.1, rootMargin: '200px' }
      );
      if (loadMoreRef.current) observer.observe(loadMoreRef.current);
      return () => observer.disconnect();
    } else {
      if (!hasNextActivitiesPage || isActivitiesLoading || isFetchingNextActivitiesPage) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) fetchNextActivitiesPage();
        },
        { threshold: 0.1, rootMargin: '200px' }
      );
      if (loadMoreRef.current) observer.observe(loadMoreRef.current);
      return () => observer.disconnect();
    }
  }, [
    activeTab,
    hasNextPostsPage,
    isPostsLoading,
    isFetchingNextPostsPage,
    fetchNextPostsPage,
    hasNextActivitiesPage,
    isActivitiesLoading,
    isFetchingNextActivitiesPage,
    fetchNextActivitiesPage
  ]);

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('saved_view_mode') || 'expanded';
  });

  useEffect(() => {
    localStorage.setItem('saved_view_mode', viewMode);
  }, [viewMode]);

  return (
    <main className="centre animate-in">
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.headerSquareBtn} onClick={() => goBack('/home')} title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h1 className={styles.title}>Saved</h1>
        </div>

        {activeTab === 'posts' && fullPosts.length > 0 && (
          <div className={styles.viewToggleGroup}>
            <button 
              className={`${styles.viewToggleBtn} ${viewMode === 'compact' ? styles.active : ''}`}
              onClick={() => setViewMode('compact')}
              title="Compact View"
            >
              <List size={18} />
            </button>
            <button 
              className={`${styles.viewToggleBtn} ${viewMode === 'expanded' ? styles.active : ''}`}
              onClick={() => setViewMode('expanded')}
              title="Expanded View"
            >
              <Grid size={18} />
            </button>
          </div>
        )}
      </header>

      {/* TABS HEADER */}
      <div className={styles.tabGroup}>
        <button
          className={`${styles.tabBtn} ${activeTab === 'activities' ? styles.active : ''}`}
          onClick={() => setActiveTab('activities')}
        >
          <Calendar size={16} />
          <span>Activities ({fullSavedActivities.length})</span>
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'posts' ? styles.active : ''}`}
          onClick={() => setActiveTab('posts')}
        >
          <FileText size={16} />
          <span>Posts ({fullPosts.length})</span>
        </button>
      </div>

      {/* CONTENT SECTION */}
      <div style={{ padding: '0.75rem' }}>
        {activeTab === 'activities' ? (
          isLoadingSavedActivities && fullSavedActivities.length === 0 ? (
            <div className={styles.activitiesGrid}>
              <CrewCardSkeleton />
              <CrewCardSkeleton />
            </div>
          ) : fullSavedActivities.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIconWrapper}>
                <Bookmark size={48} strokeWidth={1} />
              </div>
              <h2>No saved activities</h2>
              <p>Tap the bookmark on any activity to save it here</p>
            </div>
          ) : (
            <div className={styles.activitiesGrid}>
              {fullSavedActivities.map(act => (
                <CrewCard
                  key={act.id}
                  activity={act}
                  onClick={() => navigate(`/crew/${act.id}`, { state: { activity: act, from: '/saved' } })}
                />
              ))}
            </div>
          )
        ) : (
          <div className={`${styles.content} ${viewMode === 'expanded' ? styles.expandedLayout : styles.compactLayout}`}>
            {!fullPosts || fullPosts.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconWrapper}>
                  <Bookmark size={48} strokeWidth={1} />
                </div>
                <h2>Nothing saved yet</h2>
                <p>Tap the bookmark on any post to save it here</p>
              </div>
            ) : viewMode === 'expanded' ? (
              <div className={styles.expandedContainer}>
                {fullPosts.map(post => (
                  <div key={post.id} className={styles.postWrapper}>
                    <Post 
                      postData={post} 
                      hideCommunityTag={false} 
                      onClick={() => navigate(`/post/${post.id}`, { state: { post, sourceContext: 'saved', from: '/saved' } })} 
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.compactContainer}>
                {fullPosts.map(post => {
                  const author = getUserById ? getUserById(post.authorId) : null;
                  const displayName = author?.displayName || author?.username || 'Unknown';
                  const avatar = author?.avatar;
                  const previewText = post.text?.length > 80 ? post.text.substring(0, 80) + '...' : post.text;

                  return (
                    <div key={post.id} className={styles.compactRow} onClick={() => navigate(`/post/${post.id}`, { state: { post, sourceContext: 'saved', from: '/saved' } })}>
                      <div className={styles.compactAvatar}>
                        <Avatar 
                          src={avatar} 
                          name={displayName} 
                          size="36px" 
                        />
                      </div>
                      <div className={styles.compactInfo}>
                        <div className={styles.compactHeader}>
                          <span className={styles.compactAuthorName}>{displayName}</span>
                          {author?.username && <span className={styles.compactUsername}>@{author.username}</span>}
                        </div>
                        <span className={styles.compactPreview}>{previewText}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {((activeTab === 'posts' && hasNextPostsPage) || (activeTab === 'activities' && hasNextActivitiesPage)) && (
        <div ref={loadMoreRef} style={{ padding: '1.5rem', display: 'flex', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '3px' }} />
        </div>
      )}
    </main>
  );
}
