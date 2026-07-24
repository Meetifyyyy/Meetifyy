import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { Bookmark, List, Grid, ArrowLeft } from 'lucide-react';


import { useInfiniteQuery } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import Post from '../components/post/Post';
import PostSkeleton from '../components/skeletons/PostSkeleton';
import Avatar from '@shared/components/avatar/Avatar';
import styles from './SavedPage.module.css';
import { showToast } from '@shared/utils/toast';
import { useData } from '@shared/hooks/useData';


/**
 * SavedPage displays the user's saved posts.
 * It supports two display modes: "compact" and "expanded".
 * The selected mode is persisted in localStorage under the key 'saved_view_mode'.
 */
export default function SavedPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { savedPosts = [], toggleSavePost, getUserById } = useData();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading
  } = useInfiniteQuery({
    queryKey: ['bookmarks'],
    queryFn: async ({ pageParam = undefined }) => {
      const res = await postsApi.getBookmarks(20, pageParam);
      return res;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });

  const fullPosts = data?.pages.flatMap(page => page.posts) ?? [];
  const loadMoreRef = useRef(null);

  useEffect(() => {
    if (!hasNextPage || isLoading || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );
    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }
    return () => observer.disconnect();
  }, [hasNextPage, isLoading, isFetchingNextPage, fetchNextPage]);

  const [sessionSavedPostIds, setSessionSavedPostIds] = useState([]);
  
  useEffect(() => {
    if (fullPosts.length > 0) {
       setSessionSavedPostIds(fullPosts.map(p => p.id));
    }
  }, [fullPosts.length]);

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('saved_view_mode') || 'expanded';
  });

  useEffect(() => {
    localStorage.setItem('saved_view_mode', viewMode);
  }, [viewMode]);

  const handleToggleSaved = async (e, postId) => {
    e.stopPropagation();
    e.preventDefault();
    const isCurrentlySaved = savedPosts.includes(postId);
    if (toggleSavePost) {
      await toggleSavePost(postId);
    }
    showToast(isCurrentlySaved ? 'Post removed from saved' : 'Post saved');
  };



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
        
        {fullPosts.length > 0 && (
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
            {fullPosts.map(post => {
              const isSaved = savedPosts.includes(post.id);
              return (
                <div key={post.id} className={styles.postWrapper}>
                  <Post 
                    postData={post} 
                    hideCommunityTag={false} 
                    onClick={() => navigate(`/post/${post.id}`, { state: { post, sourceContext: 'saved' } })} 
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.compactContainer}>
            {fullPosts.map(post => {
              const author = getUserById ? getUserById(post.authorId) : null;
              const displayName = author?.displayName || author?.username || 'Unknown';
              const avatar = author?.avatar;
              const previewText = post.text?.length > 80 ? post.text.substring(0, 80) + '...' : post.text;
              const isSaved = savedPosts.includes(post.id);

              return (
                <div key={post.id} className={styles.compactRow} onClick={() => navigate(`/post/${post.id}`, { state: { post, sourceContext: 'saved' } })}>
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
      {hasNextPage && (
        <div ref={loadMoreRef} style={{ padding: '1.5rem', display: 'flex', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '3px' }} />
        </div>
      )}
    </main>
  );
}
