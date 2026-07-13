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
import PageHeader from '../layout/PageHeader';
import styles from './CommunitiesBrowse.module.css';

export default function CommunitiesBrowse({ onOpenCommunity }) {
  const { communities, searchQuery, setSearchQuery, currentUser } = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const [activeCategory, setActiveCategory] = useState(location.state?.category || 'all');
  const [showCreate, setShowCreate] = useState(false);

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
    if (c.isUniversity) return false;
    if (activeCategory === 'all') return true;
    const catMap = {
      technology: ['technology'],
      programming: ['technology', 'coding'],
      ai: ['ai', 'technology'],
      design: ['design', 'art'],
      art: ['art', 'design'],
      startup: ['business', 'startup'],
      science: ['science'],
      engineering: ['technology', 'engineering'],
      academics: ['education', 'academics'],
      career: ['business', 'career'],
      gaming: ['gaming'],
      anime: ['anime', 'other'],
      memes: ['other'],
      music: ['music'],
      photography: ['photography'],
      videography: ['photography', 'film'],
      film: ['film'],
      sports: ['sports'],
      fitness: ['health', 'fitness'],
      travel: ['travel'],
      food: ['food'],
      fashion: ['fashion'],
      books: ['books'],
      pets: ['pets'],
      volunteering: ['other', 'volunteering'],
      campus: ['education', 'campus'],
      entrepreneurship: ['business', 'startup'],
      content: ['other', 'content'],
      languages: ['language', 'languages'],
      health: ['health'],
      lifestyle: ['other', 'lifestyle'],
      other: ['other'],
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



  const { isLoading, data: remaining, error, retry } = useSimulatedFetch(searched, 800);

  return (
    <div className={styles.browse}>
      <PageHeader
        title="Communities"
        subtitle="Find your people. Join conversations that matter."
        backPath="/home"
        searchProps={{
          value: searchQuery,
          onChange: (e) => setSearchQuery && setSearchQuery(e.target.value),
          placeholder: 'Search communities...',
        }}
        actions={
          <button
            type="button"
            className={styles.createIconBtn}
            onClick={() => setShowCreate(true)}
            aria-label="Create Community"
            title="Create Community"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        }
        tabs={categoriesList}
        activeTab={activeCategory}
        onTabChange={setActiveCategory}
        tabVariant="pills"
      />

      <div className={styles.content}>
          {isLoading && (
            <section className={styles.gridSection}>
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
