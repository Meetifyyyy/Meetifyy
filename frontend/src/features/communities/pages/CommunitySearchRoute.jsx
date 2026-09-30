import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, X, Loader2, AlertCircle, Users } from '@shared/components/icons';
import { useDebouncedState } from '@shared/hooks/useDebounce';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useExploreCommunities } from '@shared/hooks/useCommunities';
import { useCommunityRecommendations } from '@shared/hooks/useCommunityRecommendations';
import CommunityRow from '../components/directory/CommunityRow';
import CommunityRowSkeleton from '../components/directory/CommunityRowSkeleton';
import SearchLayout from '@features/search/components/SearchLayout';
import { useDelayedFlag } from '@features/search/hooks/useDelayedFlag';
import searchStyles from '@features/search/pages/SearchResultsRoute.module.css';
import listStyles from '../components/directory/CommunityList.module.css';
import styles from './CommunitySearchRoute.module.css';

const SUGGESTION_COUNT = 20;

/**
 * /communities/search — opened from the Communities header.
 *
 * The header is the global search page's (back button beside a search pill),
 * reused from its stylesheet so the two look like one feature. The query is
 * kept in `?q=` with replace, so coming back from a community shows the same
 * results.
 *
 * Empty query: a random draw of communities the viewer is not in (the same
 * server-sampled list as "Suggested for you"), falling back to the plain
 * discovery list for someone already in all of those.
 */
export default function CommunitySearchRoute() {
  const goBack = useSmartBack();
  const navigate = useNavigate();
  const location = useLocation();
  // Opened from the Communities header: Back pops that exact entry, so the
  // page comes back with its tab (it is in the URL) and scroll position.
  // Opened any other way (a shared link): the usual smart Back.
  const openedFromCommunities = Boolean(location.state?.fromCommunities);
  const handleBack = () => (openedFromCommunities ? navigate(-1) : goBack('/communities'));
  const [params, setParams] = useSearchParams();
  const inputRef = useRef(null);
  const {
    value, debouncedValue, setValue,
  } = useDebouncedState(params.get('q') || '', 250);
  const query = debouncedValue.trim();

  // Focus after the first paint: the same approach /search takes, which is
  // what opens the keyboard on the Android app and mobile browsers.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setParams(query ? { q: query } : {}, { replace: true, state: location.state });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- state is carried, not a trigger
  }, [query, setParams]);

  const results = useExploreCommunities({ search: query });
  const { recommendations, isLoading: recsLoading } = useCommunityRecommendations(SUGGESTION_COUNT);

  const showingSuggestions = !query;
  const suggestions = recommendations.length > 0 ? recommendations : results.communities;
  const list = showingSuggestions ? suggestions : results.communities;
  const isLoading = showingSuggestions
    ? recsLoading || (recommendations.length === 0 && results.isLoading)
    : results.isLoading;
  // While a new query is in flight the previous results stay on screen, dimmed,
  // instead of the list emptying on every keystroke.
  const isUpdating = !showingSuggestions && results.isPlaceholderData;
  // Same rule as the global search field: no spinner for quick round trips.
  const showUpdating = useDelayedFlag(isUpdating, 300);

  return (
    <SearchLayout section="communities" mainClassName={styles.page}>
      <div className={styles.box}>
        <div className={`${searchStyles.header} ${styles.header}`} role="search">
          <div className={searchStyles.topRow}>
            <button type="button" className={searchStyles.backBtn} aria-label="Back to communities" onClick={handleBack}>
              <ArrowLeft size={20} />
            </button>
            <div className={searchStyles.searchPill}>
              <Search size={18} className={searchStyles.searchPillIcon} aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                inputMode="search"
                autoFocus
                enterKeyHint="search"
                className={searchStyles.searchInput}
                placeholder="Search communities"
                aria-label="Search communities"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              {showUpdating && <Loader2 size={16} className={searchStyles.updatingSpinner} aria-label="Updating results" />}
              {value && (
                <button
                  type="button"
                  className={searchStyles.clearBtn}
                  aria-label="Clear search"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setValue('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className={styles.label}>
          {showingSuggestions ? 'Communities to discover' : `Results for “${query}”`}
        </p>

        <section className={listStyles.section} aria-busy={isLoading || isUpdating} aria-live="polite">
          {isLoading && <CommunityRowSkeleton count={6} />}

          {!isLoading && !showingSuggestions && results.isError && list.length === 0 && (
            <div className={listStyles.state} role="alert">
              <span className={listStyles.stateIcon}><AlertCircle size={22} /></span>
              <h2 className={listStyles.stateTitle}>Couldn’t search right now</h2>
              <p className={listStyles.stateText}>Check your connection and try again.</p>
              <div className={listStyles.stateActions}>
                <button type="button" className={listStyles.secondaryBtn} onClick={() => results.refetch()}>Try again</button>
              </div>
            </div>
          )}

          {!isLoading && !results.isError && list.length === 0 && (
            <div className={listStyles.state}>
              <span className={listStyles.stateIcon}><Users size={22} aria-hidden="true" /></span>
              <h2 className={listStyles.stateTitle}>
                {showingSuggestions ? 'Nothing to suggest yet' : 'No communities match'}
              </h2>
              <p className={listStyles.stateText}>
                {showingSuggestions
                  ? 'There are no communities to discover right now.'
                  : 'Try a shorter or different word.'}
              </p>
            </div>
          )}

          {!isLoading && list.length > 0 && (
            <div className={`${listStyles.list} ${isUpdating ? listStyles.stale : ''}`}>
              {list.map((c) => (
                <CommunityRow key={c.id} community={c} variant="explore" />
              ))}
            </div>
          )}

          {!isLoading && !showingSuggestions && results.hasNextPage && (
            <div className={listStyles.more}>
              <button
                type="button"
                className={`${listStyles.secondaryBtn} ${results.isFetchingNextPage ? listStyles.busy : ''}`}
                onClick={() => results.fetchNextPage()}
                disabled={results.isFetchingNextPage}
                aria-busy={results.isFetchingNextPage}
              >
                <span className={listStyles.busyLabel}>Show more</span>
                {results.isFetchingNextPage && (
                  <span className={`spinner ${listStyles.busySpinner}`} role="status" aria-label="Loading more communities" />
                )}
              </button>
            </div>
          )}
        </section>
      </div>
    </SearchLayout>
  );
}
