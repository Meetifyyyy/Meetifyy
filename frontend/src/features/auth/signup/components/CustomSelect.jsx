import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from '@shared/components/icons';
import styles from '../SignupFlow.module.css';

// Damerau-Levenshtein distance to calculate spelling edit distance (tolerates insertions, deletions, substitutions, transpositions)
function damerauLevenshtein(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  const matrix = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost); // transposition
      }
    }
  }
  return matrix[len1][len2];
}

// Scores a pre-processed option against the normalized query words
function scoreMatchIndexed(opt, normQuery, queryWords) {
  const normText = opt.normalizedLabel;
  const textWords = opt.words;
  const text = opt.label;

  if (!normQuery) return { score: 0, matchRanges: [] };

  // 1. Exact Match
  if (normText === normQuery) {
    return { score: 10000, matchRanges: [[0, text.length]] };
  }

  // 2. Full Prefix Match
  if (normText.startsWith(normQuery)) {
    const startIdx = text.toLowerCase().indexOf(normQuery);
    if (startIdx !== -1) {
      return { score: 9000 - (normText.length - normQuery.length), matchRanges: [[startIdx, startIdx + normQuery.length]] };
    }
    return { score: 9000 - (normText.length - normQuery.length), matchRanges: [[0, text.length]] };
  }

  // 3. Substring Match
  const subIdx = normText.indexOf(normQuery);
  if (subIdx !== -1) {
    const origSubIdx = text.toLowerCase().indexOf(normQuery);
    if (origSubIdx !== -1) {
      return { score: 8000 - origSubIdx, matchRanges: [[origSubIdx, origSubIdx + normQuery.length]] };
    }
  }

  // 4. Word-level exact/prefix match
  let wordPrefixMatches = 0;
  let wordExactMatches = 0;

  for (const qWord of queryWords) {
    for (const tWord of textWords) {
      if (tWord === qWord) {
        wordExactMatches++;
        break;
      } else if (tWord.startsWith(qWord)) {
        wordPrefixMatches++;
        break;
      }
    }
  }

  if (wordExactMatches + wordPrefixMatches === queryWords.length) {
    const score = 7000 + (wordExactMatches * 100) + (wordPrefixMatches * 50) - normText.length;
    const ranges = [];
    for (const qWord of queryWords) {
      const idx = text.toLowerCase().indexOf(qWord);
      if (idx !== -1) {
        ranges.push([idx, idx + qWord.length]);
      }
    }
    return { score, matchRanges: ranges };
  }

  // 5. Fuzzy match (Levenshtein distance on words)
  let totalFuzzyDist = 0;
  let fuzzyMatchesCount = 0;
  const fuzzyRanges = [];

  for (const qWord of queryWords) {
    let bestDist = Infinity;
    let bestWord = '';
    
    for (const tWord of textWords) {
      const dist = damerauLevenshtein(qWord, tWord);
      if (dist < bestDist) {
        bestDist = dist;
        bestWord = tWord;
      }
    }
    
    const maxAllowedDist = Math.max(1, Math.floor(qWord.length * 0.4));
    if (bestDist <= maxAllowedDist) {
      totalFuzzyDist += bestDist;
      fuzzyMatchesCount++;
      const idx = text.toLowerCase().indexOf(bestWord);
      if (idx !== -1) {
        fuzzyRanges.push([idx, idx + bestWord.length]);
      }
    }
  }

  if (fuzzyMatchesCount === queryWords.length) {
    const score = 5000 - totalFuzzyDist * 100 - normText.length;
    return { score, matchRanges: fuzzyRanges };
  }

  // 6. Subsequence Match (as fallback)
  let qIdx = 0;
  const subseqRanges = [];
  const textLower = text.toLowerCase();
  const queryLower = normQuery.replace(/\s+/g, '');
  
  for (let i = 0; i < textLower.length && qIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[qIdx]) {
      subseqRanges.push([i, i + 1]);
      qIdx++;
    }
  }
  if (qIdx === queryLower.length && queryLower.length > 0) {
    const span = subseqRanges[subseqRanges.length - 1][0] - subseqRanges[0][0] + 1;
    const score = 3000 + (queryLower.length / span) * 1000 - subseqRanges[0][0];
    return { score, matchRanges: subseqRanges };
  }

  return { score: 0, matchRanges: [] };
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  searchable = false,
  isInvalid = false,
  className = '',
  footerAction = null,
  placement = 'auto',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpward, setIsUpward] = useState(false);
  // Fixed-position box for the portalled menu, measured from the trigger.
  const [menuBox, setMenuBox] = useState(null);
  const listRef = useRef(null);
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef(null);

  /**
   * Where the menu goes, in viewport coordinates.
   *
   * The menu is portalled to <body> and positioned `fixed`, because inside
   * the auth card it was clipped: the card has `overflow: hidden` and
   * `contain: paint`, and on mobile it scrolls. Measured against the viewport
   * instead, it opens below when there is room, flips above when there is
   * more room there, and is capped to whichever space it gets, so the whole
   * list is always reachable by scrolling inside it. `placement` is a
   * preference, not a promise: a menu that would not fit is flipped anyway.
   */
  const positionMenu = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const GAP = 6;
    const EDGE = 8;
    const IDEAL = searchable ? 320 : 280;

    const below = vh - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    let up;
    if (placement === 'top') up = above >= Math.min(IDEAL, 180) || above > below;
    else if (placement === 'bottom') up = below < Math.min(IDEAL, 180) && above > below;
    else up = below < Math.min(IDEAL, 240) && above > below;

    // Exactly the trigger's width, so the menu lines up with its field.
    const width = Math.min(r.width, vw - EDGE * 2);
    const left = Math.min(Math.max(r.left, EDGE), vw - EDGE - width);
    const maxHeight = Math.max(120, Math.min(IDEAL, up ? above : below));

    setIsUpward(up);
    setMenuBox(
      up
        ? { left, width, maxHeight, bottom: vh - r.top + GAP }
        : { left, width, maxHeight, top: r.bottom + GAP },
    );
  }, [placement, searchable]);

  const toggleDropdown = () => {
    if (!isOpen) positionMenu();
    setIsOpen(!isOpen);
  };

  /*
   * Follow the trigger while open, every frame. Listening for scroll and
   * resize was not enough: the auth card animates its height and the step
   * content rises into place, so the trigger moves without either event and
   * a menu measured at the wrong moment sat on top of its own field. One
   * rect read per frame, and state only changes when the rect does.
   */
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    let raf;
    let last = '';
    const follow = () => {
      const el = containerRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const vh = window.visualViewport?.height ?? window.innerHeight;
        const key = `${Math.round(r.top)}:${Math.round(r.left)}:${Math.round(r.width)}:${window.innerWidth}:${Math.round(vh)}`;
        if (key !== last) {
          last = key;
          positionMenu();
        }
      }
      raf = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [isOpen, positionMenu]);

  // Escape closes, as a menu should.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setInputValue('');
        setDebouncedQuery('');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Debounce input value changes
  useEffect(() => {
    if (inputValue === '') {
      setDebouncedQuery('');
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const handler = setTimeout(() => {
      setDebouncedQuery(inputValue);
      setIsSearching(false);
    }, 200);

    return () => clearTimeout(handler);
  }, [inputValue]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      // The menu lives in a portal, outside the container.
      if (listRef.current && listRef.current.contains(e.target)) return;
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setInputValue('');
        setDebouncedQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = useMemo(() => {
    return options.find(opt => opt.value === value || (value !== '' && value !== null && value !== undefined && Number(opt.value) === Number(value)));
  }, [options, value]);

  const isOptionSelected = (opt) => {
    if (opt.value === value) return true;
    if (value !== '' && value !== null && value !== undefined && Number(opt.value) === Number(value)) return true;
    return false;
  };

  // Pre-process options for high performance matching
  const indexedOptions = useMemo(() => {
    return (options || []).map(opt => ({
      ...opt,
      normalizedLabel: opt.label.toLowerCase().trim(),
      words: opt.label.toLowerCase().trim().split(/\s+/).filter(Boolean)
    }));
  }, [options]);

  // High performance filtered options using memoization and scoring
  const filteredOptions = useMemo(() => {
    if (!searchable || !debouncedQuery.trim()) {
      return indexedOptions;
    }

    const normQuery = debouncedQuery.toLowerCase().trim();
    const queryWords = normQuery.split(/\s+/).filter(Boolean);

    const scored = indexedOptions
      .map(opt => {
        const { score, matchRanges } = scoreMatchIndexed(opt, normQuery, queryWords);
        return { ...opt, score, matchRanges };
      })
      .filter(opt => opt.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored;
  }, [indexedOptions, debouncedQuery, searchable]);

  return (
    <div className={styles.customSelectContainer} ref={containerRef}>
      <button 
        type="button" 
        className={`${styles.dateSelect} ${isInvalid ? styles.invalid : ''} ${className}`.trim()} 
        onClick={toggleDropdown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 0, width: '100%' }}
      >
        <span 
          title={selectedOption ? selectedOption.label : placeholder}
          style={{ 
            color: selectedOption ? 'inherit' : 'var(--color-text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginRight: '0.35rem',
            minWidth: 0,
            flex: 1,
            textAlign: 'left'
          }}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--color-text-muted)', flexShrink: 0 }} />
      </button>
      
      {isOpen && menuBox && createPortal(
        <div
          ref={listRef}
          className={`${styles.customSelectList} ${styles.customSelectPortal} ${isUpward ? styles.openUpward : ''}`}
          style={{ padding: searchable ? 0 : '0.25rem', ...menuBox }}
        >
          {searchable && (
            <div style={{ padding: '0.5rem', position: 'sticky', top: 0, background: 'var(--color-bg-white)', zIndex: 1, borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' }}>
              <input 
                type="text" 
                className={styles.customSelectSearch}
                placeholder="Search..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
              {isSearching && (
                <div style={{ position: 'absolute', right: '1rem', width: '12px', height: '12px', border: '2px solid var(--color-border)', borderTopColor: 'var(--color-brand-primary)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
              )}
            </div>
          )}
          <ul style={{ listStyle: 'none', padding: searchable ? '0.25rem' : 0, margin: 0 }}>
            {filteredOptions.length > 0 ? filteredOptions.map((opt) => (
              <li 
                key={opt.value} 
                className={`${styles.customSelectOption} ${isOptionSelected(opt) ? styles.selected : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                  setInputValue('');
                  setDebouncedQuery('');
                }}
              >
                <span>{opt.label}</span>
                {isOptionSelected(opt) && <Check size={16} className={styles.optionCheck} />}
              </li>
            )) : (
              <li className={styles.customSelectOption} style={{ color: 'var(--color-text-muted)', cursor: 'default' }}>No results found</li>
            )}
          </ul>
          {footerAction && (
            <div
              className={styles.customSelectFooter}
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                setInputValue('');
                setDebouncedQuery('');
                footerAction.onClick?.();
              }}
            >
              <span>{footerAction.label}</span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
