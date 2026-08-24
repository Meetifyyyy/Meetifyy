import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Plus } from 'lucide-react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';

import { showToast } from '@shared/utils/toast';
import { isImageUrl } from '@shared/utils/avatar';
import Avatar from '@shared/components/avatar/Avatar';
import sharedStyles from '../components/skeletons/CampusShared.module.css';
import pageStyles from './DirectoryPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };
import { useAcademicCatalog } from '@shared/academics/useAcademicCatalog';
import { useAcademicSummary } from '@shared/academics/useAcademicSummary';
import { yearLabel } from '@shared/academics/academicCatalog';
import { useDirectory } from '@shared/hooks/useProfile';
import { useDebounce } from '@shared/hooks/useDebounce';

const SearchableMajorSelect = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { courses } = useAcademicCatalog();
  const courseOptions = useMemo(
    () => courses.map((c) => ({ value: c.id, label: c.name })),
    [courses],
  );

  const groupedMajors = useMemo(() => {
    return courseOptions.reduce((acc, course) => {
      const firstLetter = course.label[0].toUpperCase();
      if (!acc[firstLetter]) acc[firstLetter] = [];
      acc[firstLetter].push(course);
      return acc;
    }, {});
  }, [courseOptions]);

  const selectedLabel = value === 'All' ? 'Course' : courseOptions.find(m => m.value === value)?.label || 'Course';

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={styles.filterDropdown}
        onClick={() => setIsOpen(!isOpen)}
        style={{ textAlign: 'left', paddingRight: '2.5rem' }}
      >
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
          {selectedLabel}
        </span>
      </button>

      {isOpen && (
        <div className={styles.customDropdownMenu}>
          <div className={styles.customDropdownList}>
            <div
              className={`${styles.customDropdownOption} ${value === 'All' ? styles.selected : ''}`}
              onClick={() => { onChange('All'); setIsOpen(false); }}
            >
              All Majors
            </div>

            {Object.entries(groupedMajors).sort(([a], [b]) => a.localeCompare(b)).map(([letter, majors]) => (
              <div key={letter}>
                <div className={styles.customDropdownGroupHeader}>{letter}</div>
                {majors.map(m => (
                  <div
                    key={m.value}
                    className={`${styles.customDropdownOption} ${value === m.value ? styles.selected : ''}`}
                    onClick={() => { onChange(m.value); setIsOpen(false); }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            ))}

            {courseOptions.length === 0 && (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
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
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel = value === 'All' ? 'Year' : yearLabel(Number(value));

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={styles.filterDropdown}
        onClick={() => setIsOpen(!isOpen)}
        style={{ textAlign: 'left', paddingRight: '2.5rem' }}
      >
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
          {selectedLabel}
        </span>
      </button>

      {isOpen && (
        <div className={styles.customDropdownMenu} style={{ width: '180px' }}>
          <div className={styles.customDropdownList}>
            <div
              className={`${styles.customDropdownOption} ${value === 'All' ? styles.selected : ''}`}
              onClick={() => { onChange('All'); setIsOpen(false); }}
            >
              Class Year
            </div>
            
            {years.map(y => (
              <div
                key={y}
                className={`${styles.customDropdownOption} ${value === y.toString() ? styles.selected : ''}`}
                onClick={() => { onChange(y.toString()); setIsOpen(false); }}
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
 * Academic line on a directory card. Falls back to "Campus Member" for accounts
 * with no academic data — including legacy users whose Major / Year of Pass was
 * removed by the migration — so a card never renders an empty line.
 */
function DirectorySubtitle({ user }) {
  // Course + year only — the branch name is far too long for a directory card.
  const summary = useAcademicSummary(user, { branch: false });
  return <>{summary || 'Campus Member'}</>;
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
  const sentinelRef = useRef(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('Link copied', 'success');
  };

  const showCurrentUserCard = useMemo(() => {
    if (!currentUser) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matches =
        currentUser.displayName?.toLowerCase().includes(q) ||
        currentUser.username?.toLowerCase().includes(q) ||
        currentUser.bio?.toLowerCase().includes(q) ||
        currentUser.username?.toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (dirBranch !== 'All' && currentUser.course !== dirBranch) return false;
    if (dirYear !== 'All' && String(currentUser.currentYear ?? '') !== dirYear) return false;
    return true;
  }, [currentUser, searchQuery, dirBranch, dirYear]);

  // Current academic year, not a year of passing. 6 covers the longest
  // programme in the catalogue (Ph.D); shorter courses simply have no members
  // in the higher buckets.
  const classYears = [1, 2, 3, 4, 5, 6];

  return (
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      <div className={`${styles.headerBanner} ${styles.compactHeader}`}>
        <header className={styles.header}>
          {showSearch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', minHeight: '42px' }}>
              <button className={styles.headerSquareBtn} onClick={() => { setShowSearch(false); setSearchQuery(""); }} title="Close Search">
                <ArrowLeft size={20} />
              </button>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'transparent', borderRadius: '12px', padding: '0', border: 'none' }}>
                <input
                  type="text"
                  placeholder="Search students..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.headerSearchInput}
                  style={{ flex: 1, border: 'none', background: 'transparent', color: 'white', padding: '0.5rem 0.5rem', outline: 'none', fontSize: '1rem' }}
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
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <SearchableMajorSelect value={dirBranch} onChange={setDirBranch} />
          <CustomClassYearSelect value={dirYear} onChange={setDirYear} years={classYears} />
        </div>



        <div className={styles.directoryGrid}>
          {showCurrentUserCard && (
            <div
              key={`current-user-${currentUser.id}`}
              className={styles.directoryCard}
              onClick={() => navigate(`/profile/${currentUser.username}`, { state: { from: '/campus/directory' } })}
            >
              <Avatar
                src={currentUser.avatar}
                name={currentUser.displayName || currentUser.username}
                size="56px"
                showInitials
              />
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', overflow: 'hidden' }}>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '500', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {currentUser.displayName} (You)
                </h4>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  <DirectorySubtitle user={currentUser} />
                </p>
              </div>
            </div>
          )}
          {collegeStudents.map(student => (
            <div
              key={student.id}
              className={styles.directoryCard}
              onClick={() => navigate(`/profile/${student.username}`, { state: { from: '/campus/directory' } })}
            >
              <Avatar
                src={student.avatar}
                name={student.displayName || student.username}
                size="56px"
                showInitials
              />
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '500', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {student.displayName}
                </h4>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  <DirectorySubtitle user={student} />
                </p>
              </div>
            </div>
          ))}
          {!isLoading && collegeStudents.length === 0 && !showCurrentUserCard && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '2rem 0', gridColumn: '1 / -1' }}>
              No students found.
            </p>
          )}

          {/* Infinite-scroll sentinel + next-page indicator */}
          <div ref={sentinelRef} style={{ gridColumn: '1 / -1', height: 1 }} />
          {isFetchingNextPage && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '1rem 0', gridColumn: '1 / -1', fontSize: '0.85rem' }}>
              Loading more…
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

