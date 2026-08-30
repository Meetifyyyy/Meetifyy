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
import { useIsVerified } from './useIsVerified';

export const CAMPUS_EVENT_KEYS = {
  all: ['campus-events'],
  scope: (scope) => ['campus-events', 'scope', scope],
  mine: ['campus-events', 'mine'],
  byId: (id) => ['campus-events', 'detail', id],
};

/** Paginated events for one discovery scope: 'upcoming' | 'ongoing' | 'past'. */
export function useCampusEvents(scope = 'upcoming') {
  const { isLoggedIn } = useAuth();
  // Verification-gated server-side; see useCampusUsers.
  const isVerified = useIsVerified();

  const query = useInfiniteQuery({
    queryKey: CAMPUS_EVENT_KEYS.scope(scope),
    queryFn: ({ pageParam }) => campusEventsApi.list(scope, { cursor: pageParam }),
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

/** The acting representative's own events (any status), for the management view. */
export function useMyCampusEvents(enabled = true) {
  const { isLoggedIn, currentUser } = useAuth();
  const query = useQuery({
    queryKey: CAMPUS_EVENT_KEYS.mine,
    queryFn: () => campusEventsApi.getMine(),
    enabled: enabled && isLoggedIn && Boolean(currentUser?.isCampusRep),
    staleTime: 15_000,
  });
  return { events: query.data?.events ?? [], isLoading: query.isLoading };
}

function useInvalidateCampusEvents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CAMPUS_EVENT_KEYS.all });
}

export function useCreateCampusEvent() {
  const invalidate = useInvalidateCampusEvents();
  return useMutation({
    mutationFn: (data) => campusEventsApi.create(data),
    onSuccess: invalidate,
  });
}

export function useUpdateCampusEvent() {
  const invalidate = useInvalidateCampusEvents();
  return useMutation({
    mutationFn: ({ id, data }) => campusEventsApi.update(id, data),
    onSuccess: invalidate,
  });
}

export function usePublishCampusEvent() {
  const invalidate = useInvalidateCampusEvents();
  return useMutation({
    mutationFn: (id) => campusEventsApi.publish(id),
    onSuccess: invalidate,
  });
}

export function useDeleteCampusEvent() {
  const invalidate = useInvalidateCampusEvents();
  return useMutation({
    mutationFn: (id) => campusEventsApi.delete(id),
    onSuccess: invalidate,
  });
}
