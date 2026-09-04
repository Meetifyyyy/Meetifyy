/**
 * "Who to follow" — the server-ranked suggestion list.
 *
 * The caching policy here IS the feature, so it is worth being explicit about
 * what each option buys:
 *
 *   staleTime            The list must not rebuild because the viewer followed
 *                        someone. Followed rows stay put and flip to
 *                        "Following"; the list is regenerated the next time it
 *                        is genuinely fetched.
 *   refetchOnMount        Navigating away from the profile and back should show
 *   refetchOnWindowFocus  the same panel, not a reshuffled one. Neither event
 *                        re-ranks it.
 *
 * A full reload starts with an empty query cache (nothing persists this key),
 * so a refresh always regenerates — which is where already-followed accounts
 * drop out and new faces appear. That is the intended lifecycle: stable during
 * a visit, refreshed between visits.
 *
 * The payload's `isFollowing` is seeded into the shared follow-state cache, so
 * every button on screen starts from the database's answer instead of fetching
 * a profile apiece to discover it.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { seedFollowStateFromList } from '@shared/utils/followState';

export const FOLLOW_SUGGESTION_KEYS = {
  all: ['users', 'recommendations'],
  list: (limit) => ['users', 'recommendations', { limit }],
};

const EMPTY = [];

export function useFollowSuggestions(limit = 10) {
  const { isLoggedIn, currentUser } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: FOLLOW_SUGGESTION_KEYS.list(limit),
    queryFn: () => usersApi.getRecommendations(limit),
    enabled: Boolean(isLoggedIn && currentUser?.id),
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const rows = Array.isArray(query.data) ? query.data : EMPTY;

  useEffect(() => {
    seedFollowStateFromList(queryClient, rows);
  }, [queryClient, rows]);

  return {
    suggestions: rows,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
