import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { groupApi } from '@shared/api/apiClient';

export const JOIN_ACTIVITY_KEY = (groupId) => ['groupJoinActivity', String(groupId || '')];

/**
 * A group's recent requests to join, for the "@name has requested to join"
 * lines in its timeline. Owner and admins only: `enabled` is the viewer's
 * role as the server last sent it, and the server refuses anyone else.
 *
 * Held in memory only, under its own key. It is never written into the
 * group's message history (whose cache is mirrored to disk), and it is
 * dropped the moment the viewer stops being a reviewer, so a demoted admin's
 * device keeps nothing it can no longer fetch. Refreshed by
 * `group:join_requests`, which only reviewers receive.
 */
export function useGroupJoinActivity(groupId, { enabled }) {
  const queryClient = useQueryClient();
  const on = Boolean(groupId && enabled);

  useEffect(() => {
    if (!on && groupId) queryClient.removeQueries({ queryKey: JOIN_ACTIVITY_KEY(groupId) });
  }, [on, groupId, queryClient]);

  const query = useQuery({
    queryKey: JOIN_ACTIVITY_KEY(groupId),
    queryFn: () => groupApi.getJoinRequestActivity(groupId),
    enabled: on,
    staleTime: 30 * 1000,
    // A 403 means the role changed; another try would only be refused again.
    retry: (count, err) => err?.status !== 403 && count < 2,
  });

  // Rendering checks the role too: a disabled query keeps its last data.
  return on ? (query.data?.items ?? null) : null;
}
