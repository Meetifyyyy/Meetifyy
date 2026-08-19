import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import logo from '@assets/images/meetify_logo.webp';
import { searchApi } from '@shared/api/apiClient';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { useDebouncedState } from '@shared/hooks/useDebounce';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useSearchSuggestions } from '@features/search/hooks/useSearchSuggestions';
import Avatar from '@shared/components/avatar/Avatar';
import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from './GlobalSearch.module.css';

export default function GlobalSearch() {
  const navigate = useNavigate();
  const { smartNavigate } = useSmartNavigation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const q = searchParams.get('q') || '';

  const onSearchPage = location.pathname === '/search';
  const desktopLiveOnPage = !isMobile && onSearchPage;

  const {
    value: query,
    debouncedValue: debouncedQuery,
    setValue: setQuery,
    resetValue: resetQuery,
    setImmediateValue: setImmediateQuery,
  } = useDebouncedState(q, 120);

  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const { suggestions, isLoading: suggestionsLoading, isError: suggestionsError } = useSearchSuggestions(debouncedQuery, isFocused && !desktopLiveOnPage);

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

  const prevQRef = useRef(q);
  // Last debounced value the URL-writer effect acted on. See the guard note below.
  const prevDebouncedRef = useRef(debouncedQuery);

  // Sync state if URL changes externally (back/forward nav, deep link, or the
  // results page updating the URL). Never while the user is typing here: if the
  // input is focused it is the source of truth, and copying a slightly-stale URL
  // value back into it is exactly what made the text jump "hii → h → hii".
  useEffect(() => {
    if (q === prevQRef.current) return;
    prevQRef.current = q;
    if (document.activeElement === inputRef.current) return;
    setImmediateQuery(q);
  }, [q, setImmediateQuery]);

  // Desktop, already on /search: push the (debounced) query into the URL so the
  // results page updates live as the user types.
  // Guard: this effect also depends on `q`, so a URL change (e.g. from back/forward
  // nav) re-runs it with a STALE `debouncedQuery`. Writing that back would fight the
  // real value and flicker the bar, so act only when the debounced value itself moved.
  useEffect(() => {
    if (!desktopLiveOnPage) return;
    if (debouncedQuery === prevDebouncedRef.current) return;
    prevDebouncedRef.current = debouncedQuery;
    const trimmed = debouncedQuery.trim();
    if (trimmed !== q) {
      prevQRef.current = trimmed;
      setSearchParams(trimmed ? { q: trimmed } : {}, { replace: true });
    }
  }, [debouncedQuery, desktopLiveOnPage, q, setSearchParams]);

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

    if (!onSearchPage && val.trim()) {
      setPreSearchPath(location.pathname + location.search);
    }

    if (isMobile && val.trim()) {
      setIsFocused(false);
      // smartNavigate replaces once we are already on /search, so a five-letter
      // query leaves one history entry instead of five — otherwise Back would
      // walk the user back through every keystroke before leaving the page.
      smartNavigate(`/search?q=${encodeURIComponent(val.trim())}`, { state: { autoFocus: true } });
    }
  };

  const handleClear = () => {
    resetQuery('');
    prevQRef.current = '';
    setSelectedIndex(-1);
    inputRef.current?.focus();
    if (location.pathname === '/search') {
      setSearchParams({}, { replace: true });
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

  const goToEntity = (item) => {
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
  };

  // Keyboard nav options list
  const activeSuggestions = useMemo(() => {
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
        goToEntity(activeSuggestions[selectedIndex]);
      } else {
        triggerSearch();
      }
    } else if (e.key === 'Escape') {
      setIsFocused(false);
      setSelectedIndex(-1);
    }
  };

  // Dropdown shows recents (empty query) or live suggestions (typing) on both
  // breakpoints. On mobile it only ever gets to show recents in practice — the
  // moment `query` becomes non-empty, handleSearchChange has already navigated
  // away to the dedicated Search page.
  const hasQuery = query.trim().length > 0;
  // On the desktop search page the page itself is the results surface, so the header
  // never opens its own dropdown there.
  const showDropdown = isFocused && !desktopLiveOnPage && (hasQuery || recentSearches.length > 0);

  return (
    <div ref={containerRef} className={styles.container}>
      <div className={`${styles.searchBox} ${showDropdown ? styles.searchBoxOpen : ''}`}>
        <img className={styles.searchIcon} src={logo} alt="Meetifyy" onClick={() => triggerSearch()} style={{ cursor: 'pointer' }} />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          className={styles.input}
          placeholder="Search..."
          value={query}
          maxLength={100}
          onChange={handleSearchChange}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button className={styles.clearBtn} onClick={handleClear} aria-label="Clear search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>

      {showDropdown && (
        <div className={styles.dropdownMenu} role="listbox">
          {!hasQuery && recentSearches.length > 0 && (
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

          {hasQuery && suggestionsLoading && activeSuggestions.length === 0 && (
            <div className={styles.suggestionsLoading}>
              {[1, 2, 3].map(i => (
                <div key={i} className={styles.dropdownItem}>
                  <Skeleton type="circle" width="28px" height="28px" />
                  <Skeleton type="text" width="60%" height="14px" />
                </div>
              ))}
            </div>
          )}

          {hasQuery && !suggestionsLoading && suggestionsError && (
            <div className={styles.dropdownEmptyState}>Couldn't load results — try again.</div>
          )}

          {hasQuery && !suggestionsLoading && !suggestionsError && activeSuggestions.length === 0 && (
            <div className={styles.dropdownEmptyState}>No matches for "{query.trim()}"</div>
          )}

          {hasQuery && activeSuggestions.length > 0 && (
            <>
              {renderSection('People', suggestions.users, 'user', selectedIndex, activeSuggestions, goToEntity)}
              {renderSection('Communities', suggestions.communities, 'community', selectedIndex, activeSuggestions, goToEntity)}
              {renderSection('Activities', suggestions.activities, 'activity', selectedIndex, activeSuggestions, goToEntity)}
              <div className={styles.dropdownFooter} onClick={() => triggerSearch()}>
                See all results for &ldquo;{query.trim()}&rdquo;
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function entityIcon(type) {
  if (type === 'user') {
    return <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>;
  }
  if (type === 'activity') {
    return <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />;
  }
  return <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>;
}

function renderSection(label, items, type, selectedIndex, activeSuggestions, goToEntity) {
  if (!items || items.length === 0) return null;
  return (
    <React.Fragment>
      <div className={styles.dropdownHeader}>{label}</div>
      {items.map((entity) => {
        const globalIndex = activeSuggestions.findIndex(s => s.type === type && s.data?.id === entity.id);
        const isUser = type === 'user';
        return (
          <div
            key={`${type}-${entity.id}`}
            role="option"
            aria-selected={globalIndex === selectedIndex}
            className={`${styles.dropdownItem} ${globalIndex === selectedIndex ? styles.dropdownItemActive : ''}`}
            onClick={() => goToEntity({ type, data: entity })}
          >
            {isUser ? (
              <Avatar src={entity.avatar} name={entity.displayName} size="28px" disableHover />
            ) : (
              <svg className={styles.dropdownIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {entityIcon(type)}
              </svg>
            )}
            <div className={styles.dropdownItemText}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                {type === 'user' ? (entity.displayName || entity.username) : (entity.name || entity.title)}
                {type === 'user' && <CollegeRepresentativeBadge isCampusRep={entity.isCampusRep} user={entity} size="sm" />}
              </span>
              {type === 'user' && <span className={styles.dropdownItemSub}>@{entity.username}</span>}
              {type === 'activity' && entity.location && <span className={styles.dropdownItemSub}>{entity.location}</span>}
            </div>
          </div>
        );
      })}
    </React.Fragment>
  );
}
