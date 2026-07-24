import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
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
  const matchRanges = [];

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

export default function CustomSelect({ value, onChange, options, placeholder, searchable = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef(null);

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
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setInputValue('');
        setDebouncedQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => String(opt.value) === String(value));

  // Precompute normalized labels and words to speed up matching
  const indexedOptions = useMemo(() => {
    return options.map(opt => {
      const labelStr = String(opt.label);
      const normalizedLabel = labelStr.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        ...opt,
        label: labelStr,
        normalizedLabel,
        words: normalizedLabel.split(' ')
      };
    });
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!searchable || !debouncedQuery) {
      return indexedOptions.map(opt => ({ ...opt, matchRanges: [] }));
    }

    const normQuery = debouncedQuery.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normQuery) {
      return indexedOptions.map(opt => ({ ...opt, matchRanges: [] }));
    }

    const queryWords = normQuery.split(' ');

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
        className={styles.dateSelect} 
        onClick={() => setIsOpen(!isOpen)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '48px', minWidth: 0 }}
      >
        <span 
          title={selectedOption ? selectedOption.label : placeholder}
          style={{ 
            color: selectedOption ? 'inherit' : 'var(--color-text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginRight: '0.5rem',
            minWidth: 0,
            flex: 1,
            textAlign: 'left'
          }}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={18} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--color-text-muted)', flexShrink: 0 }} />
      </button>
      
      {isOpen && (
        <div className={styles.customSelectList} style={{ padding: searchable ? 0 : '0.25rem' }}>
          {searchable && (
            <div style={{ padding: '0.5rem', position: 'sticky', top: 0, background: 'white', zIndex: 1, borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' }}>
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
                <div style={{ position: 'absolute', right: '1rem', width: '12px', height: '12px', border: '2px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
              )}
            </div>
          )}
          <ul style={{ listStyle: 'none', padding: searchable ? '0.25rem' : 0, margin: 0 }}>
            {filteredOptions.length > 0 ? filteredOptions.map((opt) => (
              <li 
                key={opt.value} 
                className={`${styles.customSelectOption} ${String(opt.value) === String(value) ? styles.selected : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                  setInputValue('');
                  setDebouncedQuery('');
                }}
              >
                {opt.label}
              </li>
            )) : (
              <li className={styles.customSelectOption} style={{ color: 'var(--color-text-muted)', cursor: 'default' }}>No results found</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
