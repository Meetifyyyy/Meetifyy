import { useQuery } from '@tanstack/react-query';
import { communitiesApi } from '@shared/api/apiClient';

/**
 * The moderator permission set, from the server.
 *
 * Fetched rather than written down here on purpose. This list appears in two
 * places — the owner's confirmation before a promotion, and the new
 * moderator's welcome modal after one — and both are promises about what the
 * backend will actually allow. A copy in the client would drift the moment a
 * capability changed, and the person misled would be whoever was just handed
 * the role.
 *
 * Cached for the session: the set changes with a deploy, not with a click.
 */
export function useModeratorPermissions({ enabled = true } = {}) {
  const query = useQuery({
    queryKey: ['moderatorPermissions'],
    queryFn: async () => {
      const res = await communitiesApi.getModeratorPermissions();
      return res?.permissions || [];
    },
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return {
    permissions: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
