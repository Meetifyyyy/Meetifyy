import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import logo from '@assets/images/meetify_logo.webp';
import { searchApi } from '@shared/api/apiClient';
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
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState({ users: [], communities: [], activities: [], keywords: [] });

  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      const saved = localStorage.getItem('meetifyy_recent_searches');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string').slice(0, 15) : [];
    } catch {
      return [];
    }
  });
  
  const [preSearchPath, setPreSearchPath] = useState('/');

  // Load server-synced recent searches
  useEffect(() => {
    let mounted = true;
    searchApi.getRecentSearches()
      .then(res => {
        if (mounted && Array.isArray(res) && res.length > 0) {
          setRecentSearches(res);
          localStorage.setItem('meetifyy_recent_searches', JSON.stringify(res));
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Fetch live suggestions on query change
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions({ users: [], communities: [], activities: [], keywords: [] });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchApi.getSuggestions(query.trim(), controller.signal)
        .then(res => {
          if (res) setSuggestions(res);
        })
        .catch(() => {});
    }, 150);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // Sync state if URL changes externally
  useEffect(() => {
    setQuery(q);
  }, [q]);

  // Handle autoFocus on mount
  useEffect(() => {
    if (autoFocus && inputRef.current) {
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

  const handleSearchChange = (e) => {
    const val = e.target.value.substring(0, 100);
    setQuery(val);
    setSelectedIndex(-1);
    
    const onSearchPage = location.pathname === '/search';
    if (!onSearchPage && val.trim()) {
      setPreSearchPath(location.pathname + location.search);
    }
  };

  const handleClear = () => {
    setQuery('');
    setSelectedIndex(-1);
    inputRef.current?.focus();
    if (location.pathname === '/search') {
      navigate('/search', { replace: true });
    } else {
      navigate(preSearchPath, { replace: true });
    }
  };

  const addRecentSearch = (text) => {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    const updated = [cleanText, ...recentSearches.filter(t => t.toLowerCase() !== cleanText.toLowerCase())].slice(0, 10);
    setRecentSearches(updated);
    localStorage.setItem('meetifyy_recent_searches', JSON.stringify(updated));
    searchApi.addRecentSearch(cleanText).catch(() => {});
  };

  const removeRecentSearch = (e, text) => {
    e.stopPropagation();
    const updated = recentSearches.filter(t => t !== text);
    setRecentSearches(updated);
    localStorage.setItem('meetifyy_recent_searches', JSON.stringify(updated));
    searchApi.removeRecentSearch(text).catch(() => {});
  };

  const clearAllRecent = (e) => {
    e.stopPropagation();
    setRecentSearches([]);
    localStorage.setItem('meetifyy_recent_searches', JSON.stringify([]));
    searchApi.clearRecentSearches().catch(() => {});
  };

  const triggerSearch = (overrideTerm) => {
    const targetQuery = typeof overrideTerm === 'string' ? overrideTerm : query;
    const trimmed = targetQuery.trim();
    addRecentSearch(trimmed);
    setIsFocused(false);
    setSelectedIndex(-1);
    const onSearchPage = location.pathname === '/search';
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`, { replace: onSearchPage });
    } else {
      navigate('/search', { replace: onSearchPage });
    }
  };

  // Keyboard navigation options list
  const activeSuggestions = React.useMemo(() => {
    const list = [];
    if (!query.trim()) {
      recentSearches.forEach(term => list.push({ type: 'recent', text: term }));
    } else {
      (suggestions.users || []).forEach(u => list.push({ type: 'user', text: u.displayName || u.username, data: u }));
      (suggestions.communities || []).forEach(c => list.push({ type: 'community', text: c.name, data: c }));
      (suggestions.activities || []).forEach(a => list.push({ type: 'activity', text: a.title, data: a }));
    }
    return list;
  }, [query, recentSearches, suggestions]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < activeSuggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : activeSuggestions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && activeSuggestions[selectedIndex]) {
        const item = activeSuggestions[selectedIndex];
        if (item.type === 'user') {
          addRecentSearch(item.data.username);
          setIsFocused(false);
          navigate(`/profile/${item.data.username}`);
        } else if (item.type === 'community') {
          addRecentSearch(item.data.name);
          setIsFocused(false);
          navigate(`/communities/${item.data.id}`);
        } else if (item.type === 'activity') {
          addRecentSearch(item.data.title);
          setIsFocused(false);
          navigate(`/crew/${item.data.id}`);
        } else {
          triggerSearch(item.text);
        }
      } else {
        triggerSearch();
      }
    } else if (e.key === 'Escape') {
      setIsFocused(false);
      setSelectedIndex(-1);
    }
  };

  const showDropdown = isFocused && (query.trim() ? activeSuggestions.length > 0 : recentSearches.length > 0);

  return (
    <div ref={containerRef} className={`${styles.container} ${variant === 'bottomNav' ? styles.bottomNavContainer : ''} ${isActive ? styles.active : ''}`}>
      <div className={`${styles.searchBox} ${variant === 'bottomNav' ? styles.bottomNavSearchBox : ''} ${(variant === 'mobileSearchPage' || variant === 'pageHeader') ? styles.mobileSearchPageBox : ''} ${showDropdown ? styles.searchBoxOpen : ''}`}>
        {variant === 'bottomNav' ? (
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.bottomNavIcon} onClick={() => triggerSearch()} style={{ cursor: 'pointer' }}>
             <circle cx="11" cy="11" r="8" />
             <line x1="21" y1="21" x2="16.65" y2="16.65" />
           </svg>
        ) : (variant === 'mobileSearchPage' || variant === 'pageHeader') ? (
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.mobileSearchPageIcon} onClick={() => triggerSearch()} style={{ cursor: 'pointer' }}>
             <circle cx="11" cy="11" r="8" />
             <line x1="21" y1="21" x2="16.65" y2="16.65" />
           </svg>
        ) : (
           <img className={styles.searchIcon} src={logo} alt="Meetifyy" onClick={() => triggerSearch()} style={{ cursor: 'pointer' }} />
        )}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          className={`${styles.input} ${variant === 'bottomNav' ? styles.bottomNavInput : ''} ${(variant === 'mobileSearchPage' || variant === 'pageHeader') ? styles.mobileSearchPageInput : ''}`}
          placeholder="Search people, communities, activities..."
          value={query}
          maxLength={100}
          onChange={handleSearchChange}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button 
            className={`${styles.clearBtn} ${variant === 'bottomNav' ? styles.bottomNavClearBtn : ''}`} 
            onClick={handleClear}
            aria-label="Clear search"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>

      {showDropdown && (
        <div className={styles.dropdownMenu} role="listbox">
          {!query.trim() && recentSearches.length > 0 && (
            <>
              <div className={styles.dropdownHeader}>
                Recent Searches
                <button className={styles.clearAllBtn} onClick={clearAllRecent}>Clear all</button>
              </div>
              {recentSearches.map((text, i) => (
                <div
                  key={`recent-${i}`}
                  role="option"
                  aria-selected={selectedIndex === i}
                  className={`${styles.dropdownItem} ${selectedIndex === i ? styles.dropdownItemActive : ''}`}
                  onClick={() => triggerSearch(text)}
                >
                  <svg className={styles.dropdownIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>{text}</span>
                  <button className={styles.removeRecentBtn} aria-label="Remove search term" onClick={(e) => removeRecentSearch(e, text)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ))}
            </>
          )}

          {query.trim() && (
            <>
              <div className={styles.dropdownHeader}>Suggestions</div>
              {activeSuggestions.map((item, i) => (
                <div
                  key={`sug-${i}`}
                  role="option"
                  aria-selected={selectedIndex === i}
                  className={`${styles.dropdownItem} ${selectedIndex === i ? styles.dropdownItemActive : ''}`}
                  onClick={() => {
                    if (item.type === 'user') {
                      addRecentSearch(item.data.username);
                      setIsFocused(false);
                      navigate(`/profile/${item.data.username}`);
                    } else if (item.type === 'community') {
                      addRecentSearch(item.data.name);
                      setIsFocused(false);
                      navigate(`/communities/${item.data.id}`);
                    } else if (item.type === 'activity') {
                      addRecentSearch(item.data.title);
                      setIsFocused(false);
                      navigate(`/crew/${item.data.id}`);
                    } else {
                      triggerSearch(item.text);
                    }
                  }}
                >
                  <svg className={styles.dropdownIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {item.type === 'user' && <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>}
                    {item.type === 'activity' && <><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>}
                    {item.type === 'community' && <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>}
                  </svg>
                  <span>{item.text}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
