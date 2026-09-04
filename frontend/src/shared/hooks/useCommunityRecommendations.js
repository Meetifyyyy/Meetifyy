/**
 * "Discover Communities" — the server-sampled suggestion list.
 *
 * Same caching contract, and same reasoning, as useFollowSuggestions:
 *
 *   staleTime            The panel must not rebuild because the viewer joined
 *                        something. The joined card stays and flips to
 *                        "Joined"; the list is regenerated the next time it is
 *                        genuinely fetched.
 *   refetchOnMount        Navigating away from the profile and back shows the
 *   refetchOnWindowFocus  same panel, not a reshuffled one. Neither event
 *                        re-draws it.
 *
 * A full reload starts with an empty query cache, so a refresh always draws a
 * new selection — which is the point: stable during a visit, different between
 * visits.
 *
 * The key sits under ['communities'] on purpose. The join mutation's
 * optimistic update writes to every cache entry under that prefix, so a card
 * here updates from the same code path that updates the community page and the
 * sidebar lists, with nothing to keep in sync by hand.
 */
import { useQuery } from '@tanstack/react-query';
import { communitiesApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { COMMUNITY_KEYS } from '@shared/hooks/useCommunities';

const EMPTY = [];

export function useCommunityRecommendations(limit = 10) {
  const { isLoggedIn, currentUser } = useAuth();

  const query = useQuery({
    queryKey: COMMUNITY_KEYS.recommendations(limit),
    queryFn: () => communitiesApi.getRecommendations(limit),
    enabled: Boolean(isLoggedIn && currentUser?.id),
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    recommendations: Array.isArray(query.data) ? query.data : EMPTY,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
