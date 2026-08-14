import { useState, useEffect, useRef } from 'react';
import { usersApi } from '@shared/api/apiClient';

// Bounded, short-lived client cache so re-typing the same query (e.g.
// backspace-then-retype) doesn't re-hit the network, without ever growing
// unbounded across a long-lived composer/chat session.
const CACHE_MAX_SIZE = 50;
const CACHE_TTL_MS = 2 * 60 * 1000;
const DEBOUNCE_MS = 200;

/**
 * @mention suggestion search. Delegates ranking entirely to the backend
 * (GET /api/users/mention-search) — only a bounded, already-scored result
 * set (<= maxResults rows) ever reaches the browser, instead of the full
 * user table. See UsersService.getMentionSuggestions for the scoring logic
 * (mutual connections, recent chats, community membership, prefix match).
 */
export function useMentionSuggestions({ query = '', communityId = null, maxResults = 15 }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef(new Map()); // cacheKey -> { data, expiresAt }
  const requestIdRef = useRef(0);

  useEffect(() => {
    const cleanQuery = query.trim().toLowerCase();
    const cacheKey = `${cleanQuery}|${communityId || ''}|${maxResults}`;

    const cached = cacheRef.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setSuggestions(cached.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    // Invalidate any in-flight request from a prior keystroke so a slow
    // earlier response can never overwrite a faster, more recent one.
    const myRequestId = ++requestIdRef.current;

    const timer = setTimeout(async () => {
      try {
        const results = await usersApi.searchMentions(cleanQuery, communityId, maxResults);
        if (myRequestId !== requestIdRef.current) return;

        if (cacheRef.current.size >= CACHE_MAX_SIZE) {
          const oldestKey = cacheRef.current.keys().next().value;
          cacheRef.current.delete(oldestKey);
        }
        cacheRef.current.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });

        setSuggestions(results);
      } catch {
        if (myRequestId === requestIdRef.current) setSuggestions([]);
      } finally {
        if (myRequestId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, communityId, maxResults]);

  return { suggestions, loading };
}
