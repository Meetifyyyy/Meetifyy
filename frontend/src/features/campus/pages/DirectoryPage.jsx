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
import { MAJORS_LIST } from '../data/majors';
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '@shared/api/apiClient';

const SearchableMajorSelect = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
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

  const filteredMajors = useMemo(() => {
    const q = search.toLowerCase();
    return MAJORS_LIST.filter(m => m.value.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
  }, [search]);

  const groupedMajors = useMemo(() => {
    return filteredMajors.reduce((acc, major) => {
      const firstLetter = major.value[0].toUpperCase();
      if (!acc[firstLetter]) acc[firstLetter] = [];
      acc[firstLetter].push(major);
      return acc;
    }, {});
  }, [filteredMajors]);

  const selectedLabel = value === 'All' ? 'Major' : MAJORS_LIST.find(m => m.value === value)?.label || 'Major';

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
          <div className={styles.customDropdownSearch}>
            <Search size={14} color="var(--color-icon-base)" />
            <input
              autoFocus
              type="text"
              placeholder="Search major..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.customDropdownInput}
            />
          </div>
          <div className={styles.customDropdownList}>
            <div
              className={`${styles.customDropdownOption} ${value === 'All' ? styles.selected : ''}`}
              onClick={() => { onChange('All'); setIsOpen(false); setSearch(""); }}
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
                    onClick={() => { onChange(m.value); setIsOpen(false); setSearch(""); }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            ))}

            {filteredMajors.length === 0 && (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                No majors found.
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

  const selectedLabel = value === 'All' ? 'Class Year' : `Class of ${value}`;

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
                Class of {y}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default function DirectoryPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const { currentUser } = useAuth();

  const { data: usersData = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll().then(res => res),
  });

  // Re-map array to the object format expected by the rest of the component
  const users = useMemo(() => {
    return usersData.reduce((acc, user) => {
      acc[user.id] = user;
      return acc;
    }, {});
  }, [usersData]);

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [dirBranch, setDirBranch] = useState('All');
  const [dirYear, setDirYear] = useState('All');

  const userCollegeId = currentUser?.collegeId || 'gla';

  const collegeStudents = useMemo(() => {
    let list = Object.values(users).filter(u => u.collegeId === userCollegeId);
    list = list.filter(u => u.id !== currentUser?.id);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(u =>
        u.displayName?.toLowerCase().includes(q) ||
        u.bio?.toLowerCase().includes(q) ||
        u.major?.toLowerCase().includes(q)
      );
    }
    if (dirBranch !== 'All') list = list.filter(u => u.major === dirBranch);
    if (dirYear !== 'All') list = list.filter(u => String(u.graduationYear) === dirYear);

    return list;
  }, [users, userCollegeId, searchQuery, dirBranch, dirYear, currentUser]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('Directory link copied! 🔗');
  };

  const currentYear = new Date().getFullYear();
  const maxYear = currentYear + 6;
  const classYears = [];
  for (let y = 2026; y <= maxYear; y++) {
    classYears.push(y);
  }

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
                <button className={styles.headerSquareBtn} onClick={() => showToast('Feature coming soon!')} title="Add Student">
                  <Plus size={20} />
                </button>
              </div>
            </>
          )}
        </header>


      </div>

      <div className={styles.campusBody}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <CustomClassYearSelect value={dirYear} onChange={setDirYear} years={classYears} />
          <SearchableMajorSelect value={dirBranch} onChange={setDirBranch} />
        </div>



        <div className={styles.directoryGrid}>
          {currentUser && (
            <div
              key={`current-user-${currentUser.id}`}
              className={styles.directoryCard}
              onClick={() => navigate(`/profile/${currentUser.username}`)}
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
              </div>
            </div>
          )}
          {collegeStudents.map(student => (
            <div
              key={student.id}
              className={styles.directoryCard}
              onClick={() => navigate(`/profile/${student.username}`)}
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
                  Class of {student.year || 'XXXX'}
                </p>
              </div>
            </div>
          ))}
          {collegeStudents.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '2rem 0', gridColumn: '1 / -1' }}>
              No students found.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

