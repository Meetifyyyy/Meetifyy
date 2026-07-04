import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import { categoriesList } from '../../data/communities';
import { useData } from '../../context/DataContext';
import { useSimulatedFetch } from '../../hooks/useSimulatedFetch';
import { EmptyState, ErrorState } from '../common/StateViews';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import CommunityCard from './CommunityCard';
import CommunityCardSkeleton from './CommunityCardSkeleton';
import CommunityGrid from './CommunityGrid';
import CreateCommunityModal from './CreateCommunityModal';
import styles from './CommunitiesBrowse.module.css';

export default function CommunitiesBrowse({ onOpenCommunity }) {
  const { communities, searchQuery, setSearchQuery, currentUser } = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const [activeCategory, setActiveCategory] = useState(location.state?.category || 'all');
  const [showCreate, setShowCreate] = useState(false);
  const [showAllMyComms, setShowAllMyComms] = useState(false);

  useEffect(() => {
    if (location.state?.category) {
      setActiveCategory(location.state.category);
    }
  }, [location.state?.category]);

  const allComms = Object.values(communities).filter((c) => {
    if (c.collegeId) return false;
    return true;
  });

  const filtered = allComms.filter((c) => {
    if (activeCategory === 'all') return !c.isUniversity;
    if (activeCategory === 'colleges') return c.isUniversity;
    if (c.isUniversity) return false;
    const catMap = {
      design: ['design', 'art'],
      ai: ['technology', 'science'],
      startup: ['business', 'technology'],
      coding: ['technology'],
      gaming: ['gaming'],
      hackathons: ['technology', 'gaming'],
      sports: ['sports'],
      marketing: ['business'],
      career: ['business'],
      product: ['design', 'business'],
    };
    const matchedCats = catMap[activeCategory] || [activeCategory];
    return c.categories?.some((cat) => matchedCats.includes(cat));
  });

  const searched = filtered.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.desc?.toLowerCase().includes(q) ||
      c.categoryLabel?.toLowerCase().includes(q)
    );
  });

  const myCommunities = useMemo(() => {
    if (!currentUser?.communities) return [];
    return allComms.filter(c => currentUser.communities.includes(c.name));
  }, [allComms, currentUser]);

  const { isLoading, data: remaining, error, retry } = useSimulatedFetch(searched, 800);

  return (
    <div className={styles.browse}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <div className={styles.titleGroup}>
              <button 
                className={styles.backBtn}
                onClick={() => goBack('/home')}
                aria-label="Go back"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
              </button>
              <h1 className={styles.title}>Communities</h1>
            </div>
          </div>
          <p className={styles.subtitle}>
            Find your people. Join conversations that matter.
          </p>
        </div>
        <div className={styles.headerRight}>
          <button 
            className={styles.createTextBtn}
            onClick={() => setShowCreate(true)}
          >
            Create Community
          </button>
        </div>
      </div>

      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.searchIcon}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input 
            type="text" 
            className={styles.searchInput} 
            placeholder="Search communities..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery && setSearchQuery(e.target.value)} 
          />
        </div>
        <button 
          className={styles.createIconBtn} 
          onClick={() => setShowCreate(true)}
          aria-label="Create Community"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {myCommunities.length > 0 && (
        <section className={styles.gridSection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>My Communities</h2>
            {!showAllMyComms && myCommunities.length > 4 && (
              <button className={styles.viewAllBtn} onClick={() => setShowAllMyComms(true)}>View all</button>
            )}
          </div>
          {showAllMyComms ? (
            <CommunityGrid>
              {myCommunities.map((c) => (
                <div key={c.id} className={styles.myCommCardExpanded} onClick={() => onOpenCommunity(c.id)}>
                  <div className={styles.myCommAvatar}>
                    {isImageUrl(c.avatar) ? (
                      <img src={c.avatar} alt={c.name} />
                    ) : (
                      <DefaultAvatar />
                    )}
                  </div>
                  <div className={styles.myCommInfo}>
                    <h4 className={styles.myCommName}>{c.name}</h4>
                    <p className={styles.myCommDesc}>{c.desc}</p>
                  </div>
                </div>
              ))}
            </CommunityGrid>
          ) : (
            <div className={styles.myCommsRow}>
              {myCommunities.map((c) => (
                <div key={c.id} className={styles.myCommCard} onClick={() => onOpenCommunity(c.id)}>
                  <div className={styles.myCommAvatar}>
                    {isImageUrl(c.avatar) ? (
                      <img src={c.avatar} alt={c.name} />
                    ) : (
                      <DefaultAvatar />
                    )}
                  </div>
                  <div className={styles.myCommInfo}>
                    <h4 className={styles.myCommName}>{c.name}</h4>
                    <p className={styles.myCommDesc}>{c.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <nav className={styles.catNav}>
        {categoriesList.map((cat) => (
          <button
            key={cat.id}
            className={`${styles.catPill}${activeCategory === cat.id ? ` ${styles.catPillActive}` : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </nav>

      <div className={styles.content}>
          {isLoading && (
            <section className={styles.gridSection}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Loading...</h2>
              </div>
              <CommunityGrid>
                <CommunityCardSkeleton />
                <CommunityCardSkeleton />
                <CommunityCardSkeleton />
                <CommunityCardSkeleton />
                <CommunityCardSkeleton />
                <CommunityCardSkeleton />
              </CommunityGrid>
            </section>
          )}

          {!isLoading && error && (
            <ErrorState onRetry={retry} />
          )}

          {!isLoading && !error && remaining && remaining.length > 0 && (
            <section className={styles.gridSection}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>
                  {activeCategory === 'all' ? 'All Communities' : `${categoriesList.find(c => c.id === activeCategory)?.label || ''} Communities`}
                </h2>
                <span className={styles.sectionCount}>{remaining.length} communities</span>
              </div>
              <CommunityGrid>
                {remaining.map((c) => (
                  <CommunityCard key={c.id} comm={c} onClick={() => onOpenCommunity(c.id)} />
                ))}
              </CommunityGrid>
            </section>
          )}

          {!isLoading && !error && remaining && remaining.length === 0 && (
            <EmptyState 
              title="No communities found"
              message="We couldn't find any communities matching your search or filters."
              icon={
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              }
            />
          )}
      </div>
      {showCreate && <CreateCommunityModal onClose={() => setShowCreate(false)} onCreated={id => onOpenCommunity(id)} />}
    </div>
  );
}
