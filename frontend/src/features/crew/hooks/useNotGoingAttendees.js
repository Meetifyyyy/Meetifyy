import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { activitiesApi } from '@shared/api/apiClient';

/**
 * The "Not going" list past the first page the detail payload embeds, loaded
 * only when the viewer asks for it — the counterpart of useActivityAttendees.
 */
export function useNotGoingAttendees(activityId, { enabled = false } = {}) {
  const cleanId = activityId ? String(activityId).replace(/^(act_)+/, '') : activityId;

  const query = useInfiniteQuery({
    queryKey: ['activity', cleanId, 'attendees', 'not_going'],
    queryFn: ({ pageParam }) => activitiesApi.getAttendees(cleanId, { cursor: pageParam, status: 'not_going' }),
    enabled: Boolean(cleanId) && enabled,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const people = useMemo(
    () => query.data?.pages?.flatMap((p) => p?.attendees ?? []).map((m) => m.user).filter(Boolean) ?? [],
    [query.data],
  );

  return {
    people,
    isFetchingNextPage: query.isFetchingNextPage || (enabled && query.isLoading),
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
  };
}
