import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { toggleRegistry } from '../utils/mutationRegistry';
import {
  writeOptimisticFollowState,
  writeConfirmedFollowState,
} from '../utils/followState';
import { showToast } from '../utils/toast';
import { requestToggle } from '../utils/serialToggle';
import { PROFILE_KEYS } from './useProfile';

/**
 * Follow / unfollow:
 * 1. Instant optimistic UI on every tap.
 * 2. Requests ordered through serialToggle: one in flight per account, never
 *    aborted, at most one follow-up per burst. It used to abort the in-flight
 *    request and send the opposite one, but the server had usually received
 *    the first already, so both ran in whichever order they landed.
 * 3. The server's own answer is written as confirmed state once the burst
 *    settles; a failure restores the state the server actually holds.
 */
export function useFollowMutation(targetUsername) {
  const { currentUser, updateCurrentUser } = useAuth();
  const queryClient = useQueryClient();

  const cleanTarget = targetUsername?.toLowerCase();
  const cleanCurrent = currentUser?.username?.toLowerCase();
  const entityKey = `follow:${cleanTarget}`;

  const applyOptimisticUpdate = useCallback((isFollowing) => {
    if (!cleanTarget) return;

    // The shared follow-state entry FIRST. Every button for this account reads
    // it, so this is what makes Follow → Following happen on the same frame,
    // wherever that account is rendered — sidebar, search results, profile
    // header — without any of them refetching.
    writeOptimisticFollowState(queryClient, cleanTarget, isFollowing);

    /**
     * The follower/following lists, in place.
     *
     * The rows STAY — only their `isFollowing` changes. Unfollowing from your
     * own Following list must not make the row vanish under the cursor; the
     * list is regenerated the next time it is opened.
     *
     * Writing this through matters even though the button reads its state from
     * the shared entry above. `FollowButton` seeds that entry from the
     * `initialFollowing` prop it is handed, and the prop comes from these
     * cached rows — so leaving a row saying `isFollowing: true` after an
     * unfollow would make the button read "Following" again the next time the
     * modal was opened against that cache. The row and the shared entry have
     * to agree.
     *
     * Both shapes are handled deliberately. These are INFINITE queries, so the
     * cache holds `{ pages: [[user, …], …] }`, not an array — the presence
     * updaters in SocketManager only test `Array.isArray(old)` and are
     * therefore silent no-ops against these keys.
     */
    const updateRow = (u) =>
      u && u.username?.toLowerCase() === cleanTarget ? { ...u, isFollowing } : u;
    const updateUserListData = (old) => {
      if (!old) return old;
      if (Array.isArray(old)) return old.map(updateRow);
      if (Array.isArray(old.pages)) {
        return {
          ...old,
          pages: old.pages.map((page) =>
            Array.isArray(page) ? page.map(updateRow) : page,
          ),
        };
      }
      return old;
    };
    // Every list for every username: the same account can appear in the
    // viewer's own following list and in some third party's follower list at
    // the same time, and both are on screen at once often enough to matter.
    queryClient.setQueriesData({ queryKey: ['followers'] }, updateUserListData);
    queryClient.setQueriesData({ queryKey: ['following'] }, updateUserListData);

    // Synchronize AuthContext's currentUser.followingList immediately
    if (currentUser && targetUsername) {
      const currentList = Array.isArray(currentUser.followingList) ? currentUser.followingList : [];
      let nextList = currentList;
      if (isFollowing && !currentList.some(u => u?.toLowerCase() === cleanTarget)) {
        nextList = [...currentList, targetUsername];
      } else if (!isFollowing) {
        nextList = currentList.filter(u => u?.toLowerCase() !== cleanTarget);
      }
      if (nextList !== currentList) {
        updateCurrentUser({ ...currentUser, followingList: nextList });
      }
    }

    // Target profile by username
    queryClient.setQueryData(PROFILE_KEYS.byUsername(cleanTarget), (old) => {
      if (!old) return old;
      const currentFollowers = old.stats?.followers ?? old.followersCount ?? old.followersList?.length ?? 0;
      const currentlyFollowing = Boolean(old.isFollowing);
      const delta = isFollowing ? (currentlyFollowing ? 0 : 1) : (currentlyFollowing ? -1 : 0);
      const newFollowers = Math.max(0, currentFollowers + delta);

      let updatedFollowersList = old.followersList;
      if (Array.isArray(old.followersList) && cleanCurrent) {
        if (isFollowing && !old.followersList.includes(cleanCurrent)) {
          updatedFollowersList = [...old.followersList, cleanCurrent];
        } else if (!isFollowing) {
          updatedFollowersList = old.followersList.filter(u => u?.toLowerCase() !== cleanCurrent);
        }
      }

      return {
        ...old,
        isFollowing,
        followersCount: newFollowers,
        ...(updatedFollowersList ? { followersList: updatedFollowersList } : {}),
        stats: {
          ...old.stats,
          followers: newFollowers,
        },
      };
    });

    // Target user in generic user lists (e.g., suggested users, user cards)
    const updateUserObj = (u) => {
      if (!u) return u;
      if (u.username?.toLowerCase() === cleanTarget) {
        const currentFollowers = u.stats?.followers ?? u.followersCount ?? u.followersList?.length ?? 0;
        const currentlyFollowing = Boolean(u.isFollowing);
        const delta = isFollowing ? (currentlyFollowing ? 0 : 1) : (currentlyFollowing ? -1 : 0);
        const newFollowers = Math.max(0, currentFollowers + delta);
        return {
          ...u,
          isFollowing,
          followersCount: newFollowers,
          stats: u.stats ? {
            ...u.stats,
            followers: newFollowers,
          } : { followers: newFollowers },
        };
      }
      return u;
    };

    queryClient.setQueryData(['users'], (old) => (Array.isArray(old) ? old.map(updateUserObj) : old));
    queryClient.setQueryData(PROFILE_KEYS.campusUsers, (old) => (Array.isArray(old) ? old.map(updateUserObj) : old));
    queryClient.setQueriesData({ queryKey: PROFILE_KEYS.campusUsers }, (old) => (Array.isArray(old) ? old.map(updateUserObj) : old));

    // Update search result queries
    queryClient.setQueriesData({ queryKey: ['search'] }, (old) => {
      if (!old) return old;
      if (Array.isArray(old.users)) {
        return { ...old, users: old.users.map(updateUserObj) };
      }
      if (Array.isArray(old)) {
        return old.map(updateUserObj);
      }
      return old;
    });

    // Current user's following count
    if (cleanCurrent) {
      queryClient.setQueryData(PROFILE_KEYS.byUsername(cleanCurrent), (old) => {
        if (!old) return old;
        const currentFollowing = old.stats?.following ?? old.followingCount ?? old.followingList?.length ?? 0;
        const delta = isFollowing ? 1 : -1;
        const newFollowing = Math.max(0, currentFollowing + delta);

        let updatedFollowingList = old.followingList;
        if (Array.isArray(old.followingList)) {
          if (isFollowing && !old.followingList.includes(cleanTarget)) {
            updatedFollowingList = [...old.followingList, targetUsername];
          } else if (!isFollowing) {
            updatedFollowingList = old.followingList.filter(u => u?.toLowerCase() !== cleanTarget);
          }
        }

        return {
          ...old,
          followingCount: newFollowing,
          ...(updatedFollowingList ? { followingList: updatedFollowingList } : {}),
          stats: {
            ...old.stats,
            following: newFollowing,
          },
        };
      });
    }
  }, [queryClient, cleanTarget, cleanCurrent, currentUser, targetUsername, updateCurrentUser]);

  /** The burst has settled on `serverFollowing`: record it and mark lists stale. */
  const reconcile = useCallback((serverFollowing) => {
    // Confirmed, not merely observed: this response IS the write. It
    // re-stamps the per-account clock so any list payload still in flight
    // from before the action cannot land on top of it.
    writeConfirmedFollowState(queryClient, cleanTarget, serverFollowing);

    // ONE silent background sync — does not update UI (staleTime guard prevents flicker)
    queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(cleanTarget), refetchType: 'none' });

    // Marked stale, NOT refetched — `refetchType: 'none'`.
    //
    // An active refetch here is what removed the row you had just acted on.
    // Unfollowing from your own Following list re-ran the query, the server
    // correctly no longer returned that account, and it disappeared
    // mid-click. Worse, an infinite query refetches EVERY loaded page at once,
    // so on a long list the whole thing was rebuilt and the scroll position
    // moved under the reader. The optimistic write has already put the rows
    // in their correct state; the lists refetch when they are next mounted.
    queryClient.invalidateQueries({ queryKey: ['followers', cleanTarget], refetchType: 'none' });
    queryClient.invalidateQueries({ queryKey: ['following', cleanTarget], refetchType: 'none' });
    if (cleanCurrent) {
      queryClient.invalidateQueries({ queryKey: ['followers', cleanCurrent], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['following', cleanCurrent], refetchType: 'none' });
    }
    // NOT invalidated, deliberately: ['users', 'recommendations']. Rebuilding
    // the suggestion list here made a followed account vanish from under the
    // cursor; it is regenerated when next fetched.
  }, [queryClient, cleanTarget, cleanCurrent]);

  const toggle = useCallback((intentFollow) => {
    if (!entityKey || !cleanTarget) return;
    // Register intent for UI display (FollowButton reads this via
    // getLatestIntent). The id scopes the release to THIS tap, so an older
    // one can never clear a newer one's entry.
    const mutationId = toggleRegistry.register(entityKey, intentFollow);
    applyOptimisticUpdate(intentFollow);

    requestToggle(entityKey, intentFollow, {
      send: (target) => (target ? usersApi.follow(targetUsername) : usersApi.unfollow(targetUsername)),
      onConfirmed: (target, res, isFinal) => {
        if (!isFinal) return;
        // Release the pending intent BEFORE writing server state: while the
        // registry still holds an entry for this key, writeServerFollowState
        // deliberately declines to write.
        toggleRegistry.clearIfLatest(entityKey, mutationId);
        reconcile(typeof res?.isFollowing === 'boolean' ? res.isFollowing : target);
      },
      onFailed: (_err, { desired, confirmed }) => {
        toggleRegistry.clearIfLatest(entityKey, mutationId);
        if (desired !== confirmed) applyOptimisticUpdate(confirmed);
        showToast('Action failed', 'error');
      },
    });
  }, [entityKey, cleanTarget, targetUsername, applyOptimisticUpdate, reconcile]);

  return {
    follow: () => toggle(true),
    unfollow: () => toggle(false),
    isFollowingLoading: false,
    isUnfollowingLoading: false,
  };
}

