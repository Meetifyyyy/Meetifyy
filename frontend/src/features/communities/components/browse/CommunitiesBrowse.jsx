import { useState, useEffect, useMemo, useCallback } from 'react';
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

/**
 * Category id -> the tags, slugs and labels that count as that category.
 *
 * Module scope, because this object literal used to be constructed *inside*
 * the filter callback: one fresh thirty-key object allocated per community per
 * render, alongside a linear `categoriesList.find` for a value that depends
 * only on the selected tab. Typing in the search box re-renders on every
 * keystroke, so a thirty-community grid rebuilt nine hundred of these per
 * keypress to answer a question whose inputs had not changed.
 */
const CATEGORY_ALIASES = {
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

function matchesCategory(c, activeCategory, matchedCats, catLabel) {
  if (c.category === activeCategory) return true;
  if (c.categories?.some((cat) => matchedCats.includes(cat.toLowerCase()))) return true;
  if (matchedCats.includes(c.slug?.toLowerCase())) return true;
  if (catLabel && (c.name?.toLowerCase().includes(catLabel) || c.description?.toLowerCase().includes(catLabel))) return true;
  return false;
}

export default function CommunitiesBrowse({ onOpenCommunity }) {
  const { currentUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState(location.state?.category || 'all');
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 200);

  // Stable for the whole grid: the parent re-creates `onOpenCommunity` on each
  // of ITS renders, and a changed prop would re-render every memoised card.
  const handleSelectCommunity = useCallback((id) => onOpenCommunity(id), [onOpenCommunity]);

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

  /**
   * Filter and search, derived once per change of input rather than on every
   * render. Both passes previously re-ran whenever anything in this component
   * changed — including each keystroke's intermediate `searchQuery` state,
   * which the debounce was there to keep OUT of the filtering.
   */
  const remaining = useMemo(() => {
    const catObj = categoriesList.find((cat) => cat.id === activeCategory);
    const catLabel = catObj?.label?.toLowerCase() || '';
    const matchedCats = CATEGORY_ALIASES[activeCategory] || [activeCategory];
    const q = debouncedSearchQuery ? debouncedSearchQuery.toLowerCase() : '';

    return allComms.filter((c) => {
      if (activeCategory !== 'all' && !matchesCategory(c, activeCategory, matchedCats, catLabel)) {
        return false;
      }
      if (!q) return true;
      return (
        c.name?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
      );
    });
  }, [allComms, activeCategory, debouncedSearchQuery]);

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
                  // `onSelect` takes the id, so one stable function serves the
                  // whole grid. The inline `onClick` arrow this replaces was a
                  // fresh prop for every card on every render, which defeated
                  // CommunityCard's `memo()` entirely — typing one character in
                  // the search box re-rendered every card in the grid.
                  <CommunityCard key={c.id} comm={c} onSelect={handleSelectCommunity} />
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
