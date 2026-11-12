import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../utils/toast';
import { useGuardedMutation } from './useGuardedMutation';
import { PROFILE_KEYS, persistCachedProfile } from './useProfile';

export const FOLLOW_REQUESTS_KEY = ['followRequests'];
const PAGE_SIZE = 20;

/**
 * Requests to follow the viewer's private account, newest first.
 *
 * Shared by the Notifications page (the "Follow requests" row reads the first
 * page's `total` and first rows) and the requests page itself, so the row and
 * the page are one cache entry and never disagree about the count.
 */
export function followRequestsQueryOptions() {
  return {
    queryKey: FOLLOW_REQUESTS_KEY,
    queryFn: ({ pageParam = undefined }) =>
      usersApi.getFollowRequests({ cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    initialPageParam: undefined,
    staleTime: 1000 * 30,
  };
}

export function useFollowRequests() {
  const { currentUser } = useAuth();
  const query = useInfiniteQuery({
    ...followRequestsQueryOptions(),
    enabled: Boolean(currentUser?.id),
  });

  const requests = useMemo(
    () => query.data?.pages.flatMap((page) => page?.requests ?? []) ?? [],
    [query.data],
  );
  // Every page carries the same running total; the first is the newest read.
  const total = query.data?.pages?.[0]?.total ?? 0;

  return {
    requests,
    total,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}

/** The cached pages without the request from `userId`, and the total one lower. */
function withoutRequest(old, userId) {
  if (!old?.pages) return old;
  let removed = false;
  const pages = old.pages.map((page) => {
    if (!Array.isArray(page?.requests)) return page;
    const requests = page.requests.filter((r) => r?.user?.id !== userId);
    if (requests.length === page.requests.length) return page;
    removed = true;
    return { ...page, requests };
  });
  if (!removed) return old;
  return {
    ...old,
    pages: pages.map((page) =>
      typeof page?.total === 'number' ? { ...page, total: Math.max(0, page.total - 1) } : page,
    ),
  };
}

/**
 * Accept or decline one request.
 *
 * The row leaves the list on the tap. A 404 means the request is already gone
 * (withdrawn, or answered from another device): that is the outcome the person
 * asked for, so the row stays removed and nothing is reported. Any other
 * failure puts the row back.
 */
export function useAnswerFollowRequest() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const cleanCurrent = currentUser?.username?.toLowerCase();

  const optimisticRemove = async (userId) => {
    await queryClient.cancelQueries({ queryKey: FOLLOW_REQUESTS_KEY });
    const previous = queryClient.getQueryData(FOLLOW_REQUESTS_KEY);
    queryClient.setQueryData(FOLLOW_REQUESTS_KEY, (old) => withoutRequest(old, userId));
    return { previous };
  };

  const restore = (err, _userId, ctx) => {
    if (err?.status === 404) return;
    if (ctx?.previous !== undefined) queryClient.setQueryData(FOLLOW_REQUESTS_KEY, ctx.previous);
    showToast('Something went wrong. Please try again.', 'error');
  };

  // Marked stale, not refetched: the optimistic write is already right, and a
  // refetch would reshuffle the page under the person answering the next one.
  const settled = () => queryClient.invalidateQueries({ queryKey: FOLLOW_REQUESTS_KEY, refetchType: 'none' });

  const accept = useGuardedMutation(useMutation({
    mutationFn: (userId) => usersApi.acceptFollowRequest(userId),
    onMutate: optimisticRemove,
    onError: restore,
    onSuccess: (res) => {
      // Accepting creates a follow, so the viewer's follower count moves the
      // way it does for any new follower (see the follow.created handler).
      if (cleanCurrent && typeof res?.followersCount === 'number') {
        queryClient.setQueryData(PROFILE_KEYS.byUsername(cleanCurrent), (old) =>
          old
            ? { ...old, followersCount: res.followersCount, stats: { ...old.stats, followers: res.followersCount } }
            : old,
        );
        queryClient.invalidateQueries({ queryKey: ['followers', cleanCurrent], refetchType: 'none' });
        // The viewer's own profile copy in IndexedDB still has the old
        // follower count; a reload would paint it before the network answers.
        persistCachedProfile(queryClient, cleanCurrent);
      }
    },
    onSettled: settled,
  }), 'action');

  const decline = useGuardedMutation(useMutation({
    mutationFn: (userId) => usersApi.declineFollowRequest(userId),
    onMutate: optimisticRemove,
    onError: restore,
    onSettled: settled,
  }), 'action');

  return { accept, decline };
}
