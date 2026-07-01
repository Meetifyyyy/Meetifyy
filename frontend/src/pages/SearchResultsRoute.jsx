import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { PostResult, CommunityResult, UserResult, CollegeResult } from '../components/search/SearchResultCards';
import GlobalSearch from '../components/search/GlobalSearch';
import styles from './SearchResultsRoute.module.css';

export default function SearchResultsRoute() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('top');
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      setTimeout(() => {
        if (containerRef.current) containerRef.current.scrollTo({ top: 0 });
      }, 10);
    }
  }, [activeSection, q]);
  
  // Get up to 20 results per category on the main search page
  const { results, isSearching } = useGlobalSearch(q, 20);
  
  const handleNavigate = (path) => {
    navigate(path);
  };

  const hasResults = 
    results.posts.length > 0 || 
    results.communities.length > 0 || 
    results.users.length > 0 || 
    results.colleges.length > 0;

  // Calculate top matches (ordered categories as requested)
  const topMatches = useMemo(() => {
    const sorted = [];
    if (results.posts.length > 0) {
      sorted.push(...results.posts.slice(0, 3).map(r => ({ ...r, type: 'post' })));
    }
    if (results.users.length > 0) {
      sorted.push(...results.users.slice(0, 3).map(r => ({ ...r, type: 'user' })));
    }
    if (results.communities.length > 0) {
      sorted.push(...results.communities.slice(0, 2).map(r => ({ ...r, type: 'community' })));
    }
    if (results.colleges.length > 0) {
      sorted.push(...results.colleges.slice(0, 2).map(r => ({ ...r, type: 'college' })));
    }
    return sorted;
  }, [results]);

  const sections = [
    { id: 'top', label: 'Top' },
    { id: 'posts', label: 'Posts' },
    { id: 'users', label: 'Users' },
    { id: 'community', label: 'Community' },
    { id: 'college', label: 'College' }
  ];

  const trendingTopics = [
    { label: 'React', query: 'React', category: 'Technology' },
    { label: 'Design & Figma', query: 'Figma', category: 'UI/UX' },
    { label: 'AI & Machine Learning', query: 'AI', category: 'Data Science' },
    { label: 'Rust Programming', query: 'Rust', category: 'Backend' },
    { label: 'GLA University', query: 'GLA', category: 'College' },
    { label: 'Hackathons', query: 'hackathon', category: 'Events' }
  ];

  // if (!q.trim()) {
  //   return <Navigate to="/" replace />;
  // }
  
  return (
    <div ref={containerRef} className={`centre ${styles.container}`}>
      
      {/* Dedicated Search Bar for Mobile (Hidden on Desktop) */}
      <div className={styles.mobileSearchHeader}>
        <GlobalSearch variant="mobileSearchPage" autoFocus />
      </div>

      {!q.trim() ? (
        <div className={styles.empty} style={{ marginTop: '4rem' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" style={{ opacity: 0.7, marginBottom: '1rem' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-text-main)', margin: 0 }}>Search Meetifyy</p>
          <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>Find communities, posts, colleges, and people.</span>
        </div>
      ) : (
        <>
          <div className={styles.sectionTabs}>
            {sections.map(sec => (
              <button
                key={sec.id}
                className={`${styles.sectionTabBtn} ${activeSection === sec.id ? styles.activeSectionTab : ''}`}
                onClick={() => setActiveSection(sec.id)}
              >
                {sec.label}
              </button>
            ))}
          </div>

          {isSearching ? (
            <div className={styles.loadingContainer}>
              <div className={styles.loadingSpinner} />
              <span>Searching across Meetifyy...</span>
            </div>
          ) : !hasResults ? (
            <div className={styles.empty}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/><path d="M8 11h6"/>
              </svg>
              <p>No results found for "{q}"</p>
              <span>Try checking for typos or searching another term.</span>
            </div>
          ) : (
        <div className={styles.sectionContent}>
          {activeSection === 'top' && (
            <div className={styles.resultsContainer}>
              {topMatches.length > 0 ? (
                <div className={styles.list}>
                  {topMatches.map(r => {
                    if (r.type === 'user') return <UserResult key={`top-u-${r.item.id}`} result={r} onClick={handleNavigate} />;
                    if (r.type === 'community') return <CommunityResult key={`top-c-${r.item.id}`} result={r} onClick={handleNavigate} />;
                    if (r.type === 'college') return <CollegeResult key={`top-col-${r.item.id}`} result={r} onClick={handleNavigate} />;
                    if (r.type === 'post') return <PostResult key={`top-p-${r.item.id}`} result={r} onClick={handleNavigate} />;
                    return null;
                  })}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>No top matches found for "{q}"</div>
              )}
            </div>
          )}

          {activeSection === 'posts' && (
            <div className={styles.resultsContainer}>
              {results.posts.length > 0 ? (
                <div className={styles.list}>
                  {results.posts.map((r) => (
                    <PostResult key={`p-${r.item.id}`} result={r} onClick={handleNavigate} />
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>No posts found for "{q}"</div>
              )}
            </div>
          )}

          {activeSection === 'users' && (
            <div className={styles.resultsContainer}>
              {results.users.length > 0 ? (
                <div className={styles.list}>
                  {results.users.map((r) => (
                    <UserResult key={`u-${r.item.id}`} result={r} onClick={handleNavigate} />
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>No users found for "{q}"</div>
              )}
            </div>
          )}

          {activeSection === 'community' && (
            <div className={styles.resultsContainer}>
              {results.communities.length > 0 ? (
                <div className={styles.list}>
                  {results.communities.map((r) => (
                    <CommunityResult key={`c-${r.item.id}`} result={r} onClick={handleNavigate} />
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>No communities found for "{q}"</div>
              )}
            </div>
          )}

          {activeSection === 'college' && (
            <div className={styles.resultsContainer}>
              {results.colleges.length > 0 ? (
                <div className={styles.list}>
                  {results.colleges.map((r) => (
                    <CollegeResult key={`col-${r.item.id}`} result={r} onClick={handleNavigate} />
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>No colleges found for "{q}"</div>
              )}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
