import { useQuery } from '@tanstack/react-query';
import { searchApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useAppIdle } from './useAppIdle';

const EMPTY = { scope: 'campus', tags: [] };

/**
 * Rising hashtags for the viewer's campus. The server recomputes them every
 * 15 minutes, so the client holding a copy for 5 costs nothing in freshness.
 */
export function useTrendingHashtags() {
  const { isLoggedIn, currentUser } = useAuth();
  // A side panel: loads after the first screen (useAppIdle), not with it.
  const appIdle = useAppIdle();
  const query = useQuery({
    queryKey: ['trending', 'hashtags'],
    queryFn: () => searchApi.trendingHashtags(),
    enabled: Boolean(isLoggedIn && currentUser?.id) && appIdle,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const data = query.data && Array.isArray(query.data.tags) ? query.data : EMPTY;
  return { scope: data.scope, tags: data.tags, isLoading: query.isLoading };
}
