import { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search } from '@shared/components/icons';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';

import Avatar from '@shared/components/avatar/Avatar';
import Skeleton from '@shared/components/skeletons/Skeleton';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './DirectoryPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import { useAcademicCatalog } from '@shared/academics/useAcademicCatalog';
import { yearLabel, validPassingYears, formatAcademic } from '@shared/academics/academicCatalog';
import { useDirectory } from '@shared/hooks/useProfile';
import { useDebounce } from '@shared/hooks/useDebounce';
import CampusAffiliationGate from '../components/affiliation/CampusAffiliationGate';

/**
 * Open/close state for a filter menu, plus which value to list first.
 *
 * Picking an option closes the menu, and that pick is what changes `value`. The
 * list must not jump while that is happening, so the value to pin is captured
 * when the menu OPENS, not read live: whatever was selected at that moment is
 * listed first, and choosing something else leaves the order alone until the
 * next open.
 */
function useFilterMenu(value) {
  const [isOpen, setIsOpen] = useState(false);
  const [pinned, setPinned] = useState(value);
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggle = useCallback(() => {
    if (!isOpen) setPinned(value);
    setIsOpen(!isOpen);
  }, [isOpen, value]);

  const close = useCallback(() => setIsOpen(false), []);

  return { ref, isOpen, toggle, close, pinned };
}

/** `items` with the pinned one first and the rest in their original order. */
function pinFirst(items, valueOf, pinned) {
  const at = items.findIndex((item) => valueOf(item) === pinned);
  if (at <= 0) return items;
  return [items[at], ...items.slice(0, at), ...items.slice(at + 1)];
}

const SearchableMajorSelect = ({ value, onChange, courses }) => {
  const { ref, isOpen, toggle, close, pinned } = useFilterMenu(value);

  const courseOptions = useMemo(
    () => courses.map((c) => ({ value: c.id, label: c.name })),
    [courses],
  );
  const listed = useMemo(
    () => pinFirst(courseOptions, (m) => m.value, pinned),
    [courseOptions, pinned],
  );

  const selectedLabel = value === 'All' ? 'Course' : courseOptions.find(m => m.value === value)?.label || 'Course';

  return (
    <div ref={ref} className={styles.dropdownWrap}>
      <button
        type="button"
        className={styles.filterDropdown}
        onClick={toggle}
        style={{ textAlign: 'left', paddingRight: '2.5rem' }}
      >
        <span className={styles.filterDropdownLabel}>
          {selectedLabel}
        </span>
      </button>

      {isOpen && (
        <div className={styles.customDropdownMenu}>
          <div className={styles.customDropdownList}>
            {listed.map(m => (
              <div
                key={m.value}
                className={`${styles.customDropdownOption} ${value === m.value ? styles.selected : ''}`}
                onClick={() => {
                  // Choosing the selected option again clears the filter.
                  onChange(value === m.value ? 'All' : m.value);
                  close();
                }}
              >
                {m.label}
              </div>
            ))}

            {courseOptions.length === 0 && (
              <div className={styles.emptyDropdownNote}>
                No courses found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const CustomClassYearSelect = ({ value, onChange, years }) => {
  const { ref, isOpen, toggle, close, pinned } = useFilterMenu(value);

  // Option values are strings ('2027'), as the filter state holds them.
  const listed = useMemo(
    () => pinFirst(years, (y) => y.toString(), pinned),
    [years, pinned],
  );

  const selectedLabel = value === 'All' ? 'Passing Year' : yearLabel(Number(value));

  return (
    <div ref={ref} className={styles.dropdownWrap}>
      <button
        type="button"
        className={styles.filterDropdown}
        onClick={toggle}
        style={{ textAlign: 'left', paddingRight: '2.5rem' }}
      >
        <span className={styles.filterDropdownLabel}>
          {selectedLabel}
        </span>
      </button>

      {isOpen && (
        <div className={styles.customDropdownMenu}>
          <div className={styles.customDropdownList}>
            {listed.map(y => (
              <div
                key={y}
                className={`${styles.customDropdownOption} ${value === y.toString() ? styles.selected : ''}`}
                onClick={() => {
                  onChange(value === y.toString() ? 'All' : y.toString());
                  close();
                }}
              >
                {yearLabel(y)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * One directory row.
 *
 * The academic line used to be its own `<DirectorySubtitle>` component calling
 * `useAcademicSummary`, which calls `useAcademicCatalog` — a hook with three
 * `useState`s and an effect that awaits the catalogue. Rendered per card, that
 * was a promise subscription, three state slots and an extra render pass for
 * every student on screen, all resolving to the same shared module-level list.
 * The page loads the catalogue once now and passes it down, so a row costs one
 * `findCourse` over ~10 entries.
 *
 * Memoized because the grid re-renders on every keystroke in the search box and
 * on every page appended by the infinite scroll; without this, each of those
 * re-rendered every row already on screen. Requires a stable `onSelect`.
 */
const DirectoryCard = memo(function DirectoryCard({ user, courses, onSelect, isSelf = false }) {
  const summary = useMemo(
    () => formatAcademic(courses, user.course, user.branch, user.passingYear ?? user.currentYear, { branch: false }),
    [courses, user.course, user.branch, user.passingYear, user.currentYear],
  );

  const handleClick = useCallback(() => onSelect(user.username), [onSelect, user.username]);

  return (
    <div className={styles.directoryCard} onClick={handleClick}>
      <Avatar
        src={user.avatar}
        name={user.displayName || user.username}
        size="88px"
        /* 88px on screen against a 512px original — ask for the 160px variant. */
        thumbnail
      />
      <div className={`${styles.cardText} ${isSelf ? styles.cardTextSelf : ''}`}>
        <h4 className={styles.cardName}>
          {isSelf ? `${user.displayName} (You)` : user.displayName}
        </h4>
        <p className={styles.cardSubtitle}>
          {summary || 'Campus Member'}
        </p>
      </div>
    </div>
  );
});

/** A directory card while it loads: avatar + name/course block. */
function DirectoryCardSkeleton() {
  return (
    <div className={styles.directoryCard} style={{ cursor: 'default' }} aria-hidden="true">
      <Skeleton type="circle" width="88px" height="88px" />
      <div className={styles.cardText} style={{ gap: '0.35rem' }}>
        <Skeleton type="text" width="64px" height="0.7rem" style={{ margin: '0 auto' }} />
        <Skeleton type="text" width="48px" height="0.6rem" style={{ margin: '0 auto' }} />
      </div>
    </div>
  );
}

export default function DirectoryPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [dirBranch, setDirBranch] = useState('All');
  const [dirYear, setDirYear] = useState('All');

  // Debounced so typing hits the server at most once per pause, not per keystroke.
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Loaded once for the whole page — the filter dropdown and every card's
  // academic line read the same list. `courses` is a stable reference once
  // resolved, so the memoized rows below stay memoized.
  const { courses } = useAcademicCatalog();

  // Server-driven directory: search + filters + keyset pagination. Finds every
  // student in the college (no more 50-row client cap), small payloads per page.
  const {
    users: collegeStudents,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useDirectory({ search: debouncedSearch, course: dirBranch, year: dirYear });

  // Infinite-scroll sentinel — loads the next page as it nears the viewport.
  // Paging state is read through a ref rather than closed over: as effect
  // dependencies, `isFetchingNextPage` tore the observer down and rebuilt it on
  // both edges of every page load, which is the one moment the main thread is
  // already busy appending rows.
  const sentinelRef = useRef(null);
  const pagingRef = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  pagingRef.current = { hasNextPage, isFetchingNextPage, fetchNextPage };

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const { hasNextPage: more, isFetchingNextPage: busy, fetchNextPage: next } = pagingRef.current;
        if (entries[0]?.isIntersecting && more && !busy) next();
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage]);

  const openProfile = useCallback((username) => {
    navigate(`/profile/${username}`, { state: { from: '/campus/directory' } });
  }, [navigate]);

  const showCurrentUserCard = useMemo(() => {
    if (!currentUser) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matches =
        currentUser.displayName?.toLowerCase().includes(q) ||
        currentUser.username?.toLowerCase().includes(q) ||
        currentUser.bio?.toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (dirBranch !== 'All' && currentUser.course !== dirBranch) return false;
    if (dirYear !== 'All' && String(currentUser.passingYear ?? currentUser.currentYear ?? '') !== dirYear) return false;
    return true;
  }, [currentUser, searchQuery, dirBranch, dirYear]);

  const classYears = useMemo(() => validPassingYears(), []);

  return (
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      <CampusAffiliationGate>
        <div className={`${styles.headerBanner} ${styles.compactHeader}`}>
          <header className={styles.header}>
            {showSearch ? (
              <div className={styles.searchBar}>
                <button className={styles.headerSquareBtn} onClick={() => { setShowSearch(false); setSearchQuery(""); }} title="Close Search">
                  <ArrowLeft size={20} />
                </button>
                <div className={styles.searchInputWrap}>
                  <input
                    type="text"
                    placeholder="Search students by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`${styles.headerSearchInput} ${styles.searchInput}`}
                    autoFocus
                  />
                </div>
              </div>
            ) : (
              <>
                <div className={styles.headerLeftGroup}>
                  <button className={styles.headerSquareBtn} onClick={() => goBack('/campus')} title="Back to Campus">
                    <ArrowLeft size={20} />
                  </button>
                  <h1 className={styles.collegeTitle} style={{ margin: 0 }}>Student Directory</h1>
                </div>
                <div className={styles.headerActions}>
                  <button className={styles.headerSquareBtn} onClick={() => setShowSearch(true)} title="Search Directory">
                    <Search size={20} />
                  </button>
                </div>
              </>
            )}
          </header>
        </div>

        <div className={styles.campusBody}>
          <div className={styles.filterRow}>
            <SearchableMajorSelect value={dirBranch} onChange={setDirBranch} courses={courses} />
            <CustomClassYearSelect value={dirYear} onChange={setDirYear} years={classYears} />
          </div>

          <div className={styles.directoryGrid}>
            {showCurrentUserCard && (
              <DirectoryCard
                key={`current-user-${currentUser.id}`}
                user={currentUser}
                courses={courses}
                onSelect={openProfile}
                isSelf
              />
            )}
            {/* The server excludes the caller from this list, so the card above
                is never a duplicate of a row below it. */}
            {collegeStudents.map(student => (
              <DirectoryCard
                key={student.id}
                user={student}
                courses={courses}
                onSelect={openProfile}
              />
            ))}
            {/* First page not here yet: cards the size of the real ones,
                rather than an empty grid. */}
            {isLoading && collegeStudents.length === 0 && (
              Array.from({ length: 6 }, (_, i) => <DirectoryCardSkeleton key={`skeleton-${i}`} />)
            )}
            {!isLoading && collegeStudents.length === 0 && !showCurrentUserCard && (
              <p className={styles.emptyState}>
                No students found.
              </p>
            )}

            {/* Infinite-scroll sentinel + next-page indicator */}
            <div ref={sentinelRef} className={styles.pageSentinel} aria-hidden="true" />
            {isFetchingNextPage && (
              <div className={styles.loadingMore}>
                <span className="spinner" role="status" aria-label="Loading more students" />
              </div>
            )}
          </div>
        </div>
      </CampusAffiliationGate>
    </main>
  );
}
