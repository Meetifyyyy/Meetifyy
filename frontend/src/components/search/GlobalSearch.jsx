import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import logo from '../../assets/images/meetify logo.png';
import styles from './GlobalSearch.module.css';

export default function GlobalSearch({ variant = 'header', isActive = false, autoFocus = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  
  const [query, setQuery] = useState(q);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      const saved = localStorage.getItem('meetifyy_recent_searches');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  
  // Track where the user was before they started searching
  const [preSearchPath, setPreSearchPath] = useState('/');

  // Sync state if URL changes externally
  useEffect(() => {
    setQuery(q);
  }, [q]);

  // Handle autoFocus on mount
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      // Small timeout to ensure rendering is complete before focusing
      setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 50);
    }
  }, [autoFocus]);

  // Handle clicks outside the dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const suggestedSearches = [
    { text: 'React Developers', type: 'user' },
    { text: 'Frontend Architecture', type: 'post' },
    { text: 'GLA University', type: 'college' },
    { text: 'UI/UX Designers', type: 'community' }
  ];

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    
    const onSearchPage = location.pathname === '/search';
    if (!onSearchPage && val.trim()) {
      setPreSearchPath(location.pathname + location.search);
    }
  };

  const handleClear = () => {
    setQuery('');
    inputRef.current?.focus();
    if (location.pathname === '/search') {
      navigate('/search', { replace: true });
    } else {
      navigate(preSearchPath, { replace: true });
    }
  };

  const addRecentSearch = (text) => {
    if (!text.trim()) return;
    const updated = [text, ...recentSearches.filter(t => t !== text)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem('meetifyy_recent_searches', JSON.stringify(updated));
  };

  const removeRecentSearch = (e, text) => {
    e.stopPropagation();
    const updated = recentSearches.filter(t => t !== text);
    setRecentSearches(updated);
    localStorage.setItem('meetifyy_recent_searches', JSON.stringify(updated));
  };

  const clearAllRecent = (e) => {
    e.stopPropagation();
    setRecentSearches([]);
    localStorage.setItem('meetifyy_recent_searches', JSON.stringify([]));
  };

  const handleSuggestionClick = (text) => {
    setQuery(text);
    setIsFocused(false);
    addRecentSearch(text);
    navigate(`/search?q=${encodeURIComponent(text)}`);
  };

  const handleRecentClick = (text) => {
    setQuery(text);
    setIsFocused(false);
    navigate(`/search?q=${encodeURIComponent(text)}`);
  };

  const triggerSearch = () => {
    const trimmed = query.trim();
    addRecentSearch(trimmed);
    setIsFocused(false);
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    } else {
      navigate('/search');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      triggerSearch();
    }
  };

  const showDropdown = isFocused && !query.trim() && variant !== 'bottomNav' && variant !== 'header';

  return (
    <div ref={containerRef} className={`${styles.container} ${variant === 'bottomNav' ? styles.bottomNavContainer : ''} ${isActive ? styles.active : ''}`}>
      <div className={`${styles.searchBox} ${variant === 'bottomNav' ? styles.bottomNavSearchBox : ''} ${(variant === 'mobileSearchPage' || variant === 'pageHeader') ? styles.mobileSearchPageBox : ''} ${showDropdown ? styles.searchBoxOpen : ''}`}>
        {variant === 'bottomNav' ? (
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.bottomNavIcon} onClick={triggerSearch} style={{ cursor: 'pointer' }}>
             <circle cx="11" cy="11" r="8" />
             <line x1="21" y1="21" x2="16.65" y2="16.65" />
           </svg>
        ) : (variant === 'mobileSearchPage' || variant === 'pageHeader') ? (
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.mobileSearchPageIcon} onClick={triggerSearch} style={{ cursor: 'pointer' }}>
             <circle cx="11" cy="11" r="8" />
             <line x1="21" y1="21" x2="16.65" y2="16.65" />
           </svg>
        ) : (
           <img className={styles.searchIcon} src={logo} alt="Meetifyy" onClick={triggerSearch} style={{ cursor: 'pointer' }} />
        )}
        <input
          ref={inputRef}
          type="text"
          className={`${styles.input} ${variant === 'bottomNav' ? styles.bottomNavInput : ''} ${(variant === 'mobileSearchPage' || variant === 'pageHeader') ? styles.mobileSearchPageInput : ''}`}
          placeholder="Search..."
          value={query}
          onChange={handleSearchChange}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button 
            className={`${styles.clearBtn} ${variant === 'bottomNav' ? styles.bottomNavClearBtn : ''}`} 
            onClick={handleClear}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>

      {showDropdown && (
        <div className={styles.dropdownMenu}>
          {recentSearches.length > 0 && (
            <>
              <div className={styles.dropdownHeader}>
                Recent
                <button className={styles.clearAllBtn} onClick={clearAllRecent}>Clear all</button>
              </div>
              {recentSearches.map((text, i) => (
                <div key={`recent-${i}`} className={styles.dropdownItem} onClick={() => handleRecentClick(text)}>
                  <svg className={styles.dropdownIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>{text}</span>
                  <button className={styles.removeRecentBtn} onClick={(e) => removeRecentSearch(e, text)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ))}
              <div style={{ height: '4px', borderBottom: '1px solid var(--color-border-light)', margin: '4px 0 0' }}></div>
            </>
          )}

          <div className={styles.dropdownHeader}>Try searching for...</div>
          {suggestedSearches.map((sug, i) => (
             <div key={i} className={styles.dropdownItem} onClick={() => handleSuggestionClick(sug.text)}>
               <svg className={styles.dropdownIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                 {sug.type === 'user' && <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>}
                 {sug.type === 'post' && <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />}
                 {sug.type === 'college' && <><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" /></>}
                 {sug.type === 'community' && <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>}
               </svg>
               <span>{sug.text}</span>
             </div>
          ))}
        </div>
      )}
    </div>
  );
}

