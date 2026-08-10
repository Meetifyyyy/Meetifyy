import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { searchApi } from '@shared/api/apiClient';

const EMPTY_SUGGESTIONS = { users: [], communities: [], activities: [], keywords: [] };

/**
 * Live typeahead suggestions for the header search dropdown.
 * React Query handles request de-dupe, in-flight cancellation on query change, and caching —
 * replacing the old hand-rolled setTimeout + AbortController combo.
 */
export function useSearchSuggestions(debouncedQuery, enabled = true) {
  const trimmed = (debouncedQuery || '').trim();

  const { data, isFetching, isError } = useQuery({
    queryKey: ['searchSuggestions', trimmed],
    queryFn: ({ signal }) => searchApi.getSuggestions(trimmed, signal),
    // Gated by `enabled` (e.g. "is the dropdown actually visible?") so a hidden/unfocused
    // header doesn't keep firing suggestion requests nobody will see. Min 2 chars mirrors
    // the server (1-char patterns can't use the trigram index and match everything).
    enabled: enabled && trimmed.length >= 2 && trimmed.length <= 100,
    // Suggestions rarely change within a few seconds; a longer stale window means
    // re-typing a recent prefix is served instantly from cache with zero network.
    staleTime: 30000,
    gcTime: 60000,
    placeholderData: keepPreviousData,
  });

  return {
    suggestions: data || EMPTY_SUGGESTIONS,
    isLoading: isFetching,
    isError,
  };
}
