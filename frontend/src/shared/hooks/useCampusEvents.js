/**
 * useCampusEvents — data hooks for the official Campus Events feature.
 *
 * Read hooks power the Campus page discovery sections (upcoming / ongoing / past)
 * and the event detail page. Mutation hooks are used by Campus Representatives to
 * create / update / publish / delete their events, and invalidate the relevant
 * query caches so discovery stays fresh.
 */
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { campusEventsApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useHasCampusAccess, useCampusDeniedHandler } from './useCampusAffiliation';
import { useGuardedMutation } from '@shared/hooks/useGuardedMutation';

export const CAMPUS_EVENT_KEYS = {
  all: ['campus-events'],
  scope: (scope) => ['campus-events', 'scope', scope],
  mine: ['campus-events', 'mine'],
  byId: (id) => ['campus-events', 'detail', id],
};

/** Paginated events for one discovery scope: 'upcoming' | 'ongoing' | 'past'. */
export function useCampusEvents(scope = 'upcoming') {
  const { isLoggedIn } = useAuth();
  // Gated server-side by campus affiliation; see useCampusUsers.
  const isVerified = useHasCampusAccess();
  const onDenied = useCampusDeniedHandler();

  const query = useInfiniteQuery({
    queryKey: CAMPUS_EVENT_KEYS.scope(scope),
    queryFn: ({ pageParam }) =>
      campusEventsApi.list(scope, { cursor: pageParam }).catch((err) => {
        onDenied(err);
        throw err;
      }),
    enabled: Boolean(isLoggedIn) && isVerified,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const events = useMemo(
    () => query.data?.pages?.flatMap((p) => (Array.isArray(p?.events) ? p.events : [])) ?? [],
    [query.data],
  );

  return {
    events,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}

/** Single event for the detail page. */
export function useCampusEvent(id) {
  return useQuery({
    queryKey: CAMPUS_EVENT_KEYS.byId(id),
    queryFn: () => campusEventsApi.getById(id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

function useInvalidateCampusEvents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CAMPUS_EVENT_KEYS.all });
}

export function useCreateCampusEvent() {
  const invalidate = useInvalidateCampusEvents();
  const mutation = useMutation({
    mutationFn: (data) => campusEventsApi.create(data),
    onSuccess: invalidate,
  });
  return useGuardedMutation(mutation, 'event');
}

export function useUpdateCampusEvent() {
  const invalidate = useInvalidateCampusEvents();
  const mutation = useMutation({
    mutationFn: ({ id, data }) => campusEventsApi.update(id, data),
    onSuccess: invalidate,
  });
  return useGuardedMutation(mutation, 'event');
}

export function usePublishCampusEvent() {
  const invalidate = useInvalidateCampusEvents();
  const mutation = useMutation({
    mutationFn: (id) => campusEventsApi.publish(id),
    onSuccess: invalidate,
  });
  return useGuardedMutation(mutation, 'event');
}

export function useDeleteCampusEvent() {
  const invalidate = useInvalidateCampusEvents();
  const mutation = useMutation({
    mutationFn: (id) => campusEventsApi.delete(id),
    onSuccess: invalidate,
  });
  return useGuardedMutation(mutation, 'action');
}
