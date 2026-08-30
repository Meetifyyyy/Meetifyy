import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@shared/context/AuthContext';
import { useCommunities } from '@shared/hooks/useCommunities';
import { categoriesList } from '@constants/communityCategories';
import { openVerificationModal } from '@shared/stores/verificationModalStore';

import { useDebounce } from '@shared/hooks/useDebounce';
import { EmptyState, ErrorState } from '@shared/components/ui/StateViews';
import CommunityCard from '../card/CommunityCard';
import CommunityCardSkeleton from '../card/CommunityCardSkeleton';
import CommunityGrid from '../card/CommunityGrid';
import CreateCommunityModal from '../modals/CreateCommunityModal';
import PageHeader from '@layout/PageHeader';
import styles from './CommunitiesBrowse.module.css';

export default function CommunitiesBrowse({ onOpenCommunity }) {
  const { currentUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState(location.state?.category || 'all');
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 200);

  const handleCreateClick = () => {
    if (currentUser?.verificationStatus !== 'VERIFIED') {
      openVerificationModal('Verify your student ID to create a community.');
      return;
    }
    setShowCreate(true);
  };

  useEffect(() => {
    if (location.state?.category) {
      setActiveCategory(location.state.category);
    }
  }, [location.state?.category]);

  const { rawCommunities, isLoading, isError, refetch } = useCommunities();
  const error = isError;
  const allComms = rawCommunities || [];

  const filtered = allComms.filter((c) => {
    if (activeCategory === 'all') return true;
    const catObj = categoriesList.find(cat => cat.id === activeCategory);
    const catLabel = catObj?.label?.toLowerCase() || '';

    const catMap = {
      technology: ['technology', 'tech', 'coding'],
      programming: ['technology', 'coding', 'programming'],
      ai: ['ai', 'technology', 'artificial intelligence'],
      design: ['design', 'art', 'ui', 'ux'],
      art: ['art', 'design', 'drawing', 'painting'],
      startup: ['business', 'startup', 'entrepreneurship'],
      science: ['science', 'tech'],
      engineering: ['technology', 'engineering', 'coding'],
      academics: ['education', 'academics', 'study'],
      career: ['business', 'career', 'jobs'],
      gaming: ['gaming', 'games', 'esports'],
      anime: ['anime', 'manga', 'other'],
      memes: ['memes', 'humor', 'other'],
      music: ['music', 'audio', 'songs'],
      photography: ['photography', 'photos'],
      videography: ['photography', 'film', 'video'],
      movies: ['film', 'movies', 'cinema'],
      sports: ['sports', 'fitness', 'athletics'],
      fitness: ['health', 'fitness', 'gym', 'workout'],
      travel: ['travel', 'explore'],
      food: ['food', 'cooking', 'dining'],
      fashion: ['fashion', 'style'],
      books: ['books', 'literature', 'reading'],
      pets: ['pets', 'animals', 'dogs', 'cats'],
      volunteering: ['volunteering', 'other'],
      campus: ['education', 'campus', 'college', 'university'],
      entrepreneurship: ['business', 'startup', 'entrepreneurship'],
      content: ['content', 'other', 'youtube'],
      languages: ['language', 'languages', 'linguistics'],
      health: ['health', 'wellness'],
      lifestyle: ['lifestyle', 'other'],
      other: ['other'],
    };
    const matchedCats = catMap[activeCategory] || [activeCategory];
    
    if (c.category === activeCategory) return true;
    if (c.categories?.some((cat) => matchedCats.includes(cat.toLowerCase()))) return true;
    if (matchedCats.includes(c.slug?.toLowerCase())) return true;
    if (catLabel && (c.name?.toLowerCase().includes(catLabel) || c.description?.toLowerCase().includes(catLabel))) return true;

    return false;
  });

  const searched = filtered.filter((c) => {
    if (!debouncedSearchQuery) return true;
    const q = debouncedSearchQuery.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q)
    );
  });

  const remaining = searched;
  const retry = refetch;

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
            onClick={handleCreateClick}
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
              title="No communities here yet"
              icon={
                <div style={{ fontSize: '3rem', marginBottom: '1rem', lineHeight: 1 }}>
                  🌐
                </div>
              }
              action={
                <button
                  type="button"
                  className={styles.emptyCreateBtn}
                  onClick={handleCreateClick}
                >
                  <PlusIcon className={styles.btnIcon} />
                  <span>Create a Community</span>
                </button>
              }
            />
          )}
      </div>
      {showCreate && <CreateCommunityModal onClose={() => setShowCreate(false)} onCreated={id => onOpenCommunity(id)} />}
    </div>
  );
}
