import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, X, Loader2, AlertCircle, Activity } from '@shared/components/icons';
import { useAuth } from '@shared/context/AuthContext';
import { useDebouncedState } from '@shared/hooks/useDebounce';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useActivities, useCrewDiscover, useSavedActivitiesQuery, useMyActivitiesQuery } from '@shared/hooks/useCrew';
import { prefetchActivity } from '@shared/hooks/prefetch';
import { mapActivity } from '@shared/utils/mapActivity';
import SearchLayout from '@features/search/components/SearchLayout';
import { useDelayedFlag } from '@features/search/hooks/useDelayedFlag';
import { useGlobalSearch } from '@features/search/hooks/useGlobalSearch';
import searchStyles from '@features/search/pages/SearchResultsRoute.module.css';
import CrewCard from '../components/cards/CrewCard';
import CrewCardSkeleton from '../components/cards/CrewCardSkeleton';
import { filterActivities } from '../utils/crewUtils';
import {
  CREW_TAB_SLUGS,
  TAB_ALL,
  TAB_MINE,
  TAB_ONE_ON_ONE,
  TAB_SAVED,
  slugToTab,
  tabToSlug,
} from '../utils/crewTabs';
import styles from './CrewSearchRoute.module.css';

const mapAll = (list) => (list || []).map(mapActivity).filter(Boolean);

/**
 * /crew/search — opened from the Crew header on phones.
 *
 * Built the same way as /communities/search: the global search page's header
 * (back button beside a search pill), reused from its stylesheet, inside the
 * shared SearchLayout frame. Below it are the same pills the Crew page shows,
 * each narrowing what is searched. The query (`?q=`) and pill (`?tab=`) are
 * kept in the URL with replace, so coming back from an activity shows the same
 * results.
 *
 * All searches the server (the global search, activities only); the other
 * pills filter the list that pill shows on the Crew page.
 */
export default function CrewSearchRoute() {
  const goBack = useSmartBack();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { currentUser, collegeName: authCollegeName } = useAuth();
  // Opened from the Crew header: Back pops that exact entry, so the page comes
  // back with its tab and scroll position. Any other way: the usual smart Back.
  const openedFromCrew = Boolean(location.state?.fromCrew);
  const handleBack = () => (openedFromCrew ? navigate(-1) : goBack('/crew'));
  const [params, setParams] = useSearchParams();
  const inputRef = useRef(null);
  const {
    value, debouncedValue, setValue,
  } = useDebouncedState(params.get('q') || '', 250);
  const query = debouncedValue.trim();

  const rawSlug = params.get('tab');
  const tabSlug = rawSlug && CREW_TAB_SLUGS.includes(rawSlug) ? rawSlug : 'all';

  const { collegeName: discCollegeName } = useCrewDiscover();
  const hasCollege = Boolean(
    currentUser?.collegeId || currentUser?.college || currentUser?.university || currentUser?.campus,
  );
  const collegeTab = (discCollegeName || (hasCollege ? authCollegeName : null)) || null;
  const selectedTab = slugToTab(tabSlug, collegeTab);
  const isCollegeTab = Boolean(collegeTab) && selectedTab === collegeTab;
  const isAllTab = selectedTab === TAB_ALL;
  const tabs = [TAB_ALL, ...(collegeTab ? [collegeTab] : []), TAB_ONE_ON_ONE, TAB_MINE, TAB_SAVED];

  // Focus after the first paint: the same approach /search takes, which is
  // what opens the keyboard on the Android app and mobile browsers.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, []);

  const writeParams = useCallback((q, slug) => {
    const next = {};
    if (q) next.q = q;
    if (slug && slug !== 'all') next.tab = slug;
    setParams(next, { replace: true, state: location.state });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- state is carried, not a trigger
  }, [setParams]);

  useEffect(() => {
    writeParams(query, tabSlug);
  }, [query, tabSlug, writeParams]);

  const selectTab = (tab) => writeParams(query, tabToSlug(tab, collegeTab));

  // ── Sources: each fetches only while its pill is selected ─────────────────
  const serverSearch = useGlobalSearch(isAllTab ? query : '', 30, 'activities');
  const forYouFeed = useActivities('for_you', { enabled: isAllTab && !query });
  const collegeFeed = useActivities('college', { enabled: isCollegeTab });
  const oneOnOneFeed = useActivities('one_on_one', { enabled: selectedTab === TAB_ONE_ON_ONE });
  const { savedActivitiesData, isLoading: savedLoading } = useSavedActivitiesQuery();
  const { myActivitiesData, isLoading: mineLoading } = useMyActivitiesQuery();

  const serverActivities = serverSearch.results.crew;
  const list = useMemo(() => {
    if (isAllTab) {
      if (query) return mapAll(serverActivities.map((r) => r.item));
      return mapAll(forYouFeed.activities);
    }
    let pool = [];
    if (isCollegeTab) pool = collegeFeed.activities;
    else if (selectedTab === TAB_ONE_ON_ONE) pool = oneOnOneFeed.activities;
    else if (selectedTab === TAB_MINE) pool = myActivitiesData;
    else if (selectedTab === TAB_SAVED) pool = savedActivitiesData;
    return filterActivities(mapAll(pool), { search: query });
  }, [isAllTab, isCollegeTab, selectedTab, query, serverActivities, forYouFeed.activities,
      collegeFeed.activities, oneOnOneFeed.activities, myActivitiesData, savedActivitiesData]);

  const paged = isAllTab
    ? (query ? serverSearch : forYouFeed)
    : isCollegeTab
      ? collegeFeed
      : selectedTab === TAB_ONE_ON_ONE
        ? oneOnOneFeed
        : null;

  const isLoading = isAllTab
    ? (query ? serverSearch.isLoading : forYouFeed.isLoading)
    : isCollegeTab
      ? collegeFeed.isLoading
      : selectedTab === TAB_ONE_ON_ONE
        ? oneOnOneFeed.isLoading
        : selectedTab === TAB_MINE
          ? mineLoading
          : savedLoading;
  const isError = isAllTab && query ? serverSearch.isError : Boolean(paged?.isError);
  // While a new query is in flight the previous results stay on screen, dimmed.
  const isUpdating = isAllTab && Boolean(query) && serverSearch.isSearching && !serverSearch.isLoading;
  // Same rule as the global search field: no spinner for quick round trips.
  const showUpdating = useDelayedFlag(isUpdating, 300);

  const byId = useRef(new Map());
  byId.current = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);
  const handleOpen = useCallback((id) => {
    navigate(`/crew/${id}`, { state: { activity: byId.current.get(id), from: '/crew/search' } });
  }, [navigate]);
  const handleHover = useCallback((id) => prefetchActivity(queryClient, id), [queryClient]);

  const label = query
    ? `Results for “${query}”`
    : isAllTab ? 'Activities for you' : selectedTab;

  return (
    <SearchLayout section="activities" mainClassName={styles.page}>
      <div className={styles.box}>
        <div className={`${searchStyles.header} ${styles.header}`} role="search">
          <div className={searchStyles.topRow}>
            <button type="button" className={searchStyles.backBtn} aria-label="Back to crew" onClick={handleBack}>
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
                placeholder="Search activities"
                aria-label="Search activities"
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
          <div className={styles.chips} role="tablist" aria-label="Activity filters">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={tab === selectedTab}
                className={`${styles.chip} ${tab === selectedTab ? styles.chipActive : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <p className={styles.label}>{label}</p>

        <section className={styles.section} aria-busy={isLoading || isUpdating} aria-live="polite">
          {isLoading && (
            <div className={styles.list}>
              <CrewCardSkeleton />
              <CrewCardSkeleton />
              <CrewCardSkeleton />
            </div>
          )}

          {!isLoading && isError && list.length === 0 && (
            <div className={styles.state} role="alert">
              <span className={styles.stateIcon}><AlertCircle size={22} /></span>
              <h2 className={styles.stateTitle}>Couldn’t search right now</h2>
              <p className={styles.stateText}>Check your connection and try again.</p>
              {isAllTab && query && (
                <button type="button" className={styles.secondaryBtn} onClick={() => serverSearch.refetch()}>Try again</button>
              )}
            </div>
          )}

          {!isLoading && !isError && list.length === 0 && (
            <div className={styles.state}>
              <span className={styles.stateIcon}><Activity size={22} aria-hidden="true" /></span>
              <h2 className={styles.stateTitle}>{query ? 'No activities match' : 'Nothing here yet'}</h2>
              <p className={styles.stateText}>
                {query ? 'Try a shorter or different word.' : 'There are no activities to show for this filter.'}
              </p>
            </div>
          )}

          {!isLoading && list.length > 0 && (
            <div className={`${styles.list} ${isUpdating ? styles.stale : ''}`}>
              {list.map((a) => (
                <CrewCard key={a.id} activity={a} onClick={handleOpen} onMouseEnter={handleHover} />
              ))}
            </div>
          )}

          {!isLoading && paged?.hasNextPage && (
            <div className={styles.more}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => paged.fetchNextPage()}
                disabled={paged.isFetchingNextPage}
                aria-busy={paged.isFetchingNextPage}
              >
                {paged.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </section>
      </div>
    </SearchLayout>
  );
}
