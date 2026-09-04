import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { toggleRegistry } from '../utils/mutationRegistry';
import {
  writeOptimisticFollowState,
  writeServerFollowState,
} from '../utils/followState';
import { showToast } from '../utils/toast';
import { PROFILE_KEYS } from './useProfile';

// Module-level stores so they persist across renders without causing re-renders
const activeControllers = new Map();   // entityKey -> AbortController
const pendingTimers = new Map();       // entityKey -> setTimeout ID
const pendingIntents = new Map();      // entityKey -> boolean (true=follow, false=unfollow)

const DEBOUNCE_MS = 300;

/**
 * Production-grade follow mutation hook with:
 * 1. Instant 0ms optimistic UI updates on every click
 * 2. Request coalescing — only 1 HTTP request per click burst (debounced 300ms)
 * 3. AbortController — cancels in-flight requests when user intent changes
 * 4. Mutation versioning — stale responses never overwrite newer optimistic state
 * 5. One silent refetch only after the FINAL mutation settles
 */
export function useFollowMutation(targetUsername) {
  const { currentUser, updateCurrentUser } = useAuth();
  const queryClient = useQueryClient();
  const mutationSeqRef = useRef(0);

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

  const scheduleRequest = useCallback((intentFollow, mutationId) => {
    if (!cleanTarget) return;

    // --- Step 1: Cancel any pending timer for this entity ---
    if (pendingTimers.has(entityKey)) {
      clearTimeout(pendingTimers.get(entityKey));
    }

    // --- Step 2: Abort any in-flight request for this entity ---
    if (activeControllers.has(entityKey)) {
      activeControllers.get(entityKey).abort();
      activeControllers.delete(entityKey);
    }

    // --- Step 3: Record latest pending intent ---
    pendingIntents.set(entityKey, intentFollow);

    // --- Step 4: Schedule the debounced network call ---
    const timerId = setTimeout(async () => {
      pendingTimers.delete(entityKey);

      const finalIntent = pendingIntents.get(entityKey);
      pendingIntents.delete(entityKey);

      const seq = ++mutationSeqRef.current;
      const controller = new AbortController();
      activeControllers.set(entityKey, controller);

      try {
        const res = finalIntent
          ? await usersApi.follow(targetUsername, { signal: controller.signal })
          : await usersApi.unfollow(targetUsername, { signal: controller.signal });

        // Only reconcile if this is still the latest sequence
        if (seq === mutationSeqRef.current) {
          activeControllers.delete(entityKey);
          // Release the pending intent BEFORE writing server state: while the
          // registry still holds an entry for this key, writeServerFollowState
          // deliberately declines to write (a newer click would outrank a
          // response already on the wire).
          toggleRegistry.clearIfLatest(entityKey, mutationId);

          // The response is the database's own answer — `isFollowing` after
          // the write. Recording it means the UI is confirmed against the
          // server on every action rather than trusting the optimistic guess
          // until something else happens to refetch.
          const serverFollowing =
            typeof res?.isFollowing === 'boolean' ? res.isFollowing : finalIntent;
          writeServerFollowState(queryClient, cleanTarget, serverFollowing);

          // ONE silent background sync — does not update UI (staleTime guard prevents flicker)
          queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.byUsername(cleanTarget), refetchType: 'none' });

          // Marked stale, NOT refetched — `refetchType: 'none'`.
          //
          // An active refetch here is what removed the row you had just acted
          // on. Unfollowing from your own Following list re-ran the query, the
          // server correctly no longer returned that account, and it
          // disappeared mid-click. Worse, an infinite query refetches EVERY
          // loaded page at once, so on a long list the whole thing was rebuilt
          // and the scroll position moved under the reader.
          //
          // The optimistic write above has already put the rows in their
          // correct state, so nothing on screen is wrong; the lists refetch
          // when they are next mounted, which for these modals is the next
          // time one is opened. Same rule as the profile sidebar: an action
          // changes an item's state, never the list's membership.
          queryClient.invalidateQueries({ queryKey: ['followers', cleanTarget], refetchType: 'none' });
          queryClient.invalidateQueries({ queryKey: ['following', cleanTarget], refetchType: 'none' });
          if (cleanCurrent) {
            queryClient.invalidateQueries({ queryKey: ['followers', cleanCurrent], refetchType: 'none' });
            queryClient.invalidateQueries({ queryKey: ['following', cleanCurrent], refetchType: 'none' });
          }
          // NOT invalidated, deliberately: ['users', 'recommendations'].
          // Rebuilding the suggestion list here is what used to make a
          // followed account vanish from under the cursor. The list is
          // regenerated when it is next fetched — on a reload, or after its
          // staleTime — and the account just followed keeps its place until
          // then, showing "Following".
        }
      } catch (err) {
        activeControllers.delete(entityKey);
        // If aborted, it means a newer request took over — don't do anything
        if (err?.name === 'AbortError' || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
          toggleRegistry.clearIfLatest(entityKey, mutationId);
          return;
        }
        // If this isn't the latest sequence, swallow the error silently
        if (seq !== mutationSeqRef.current) {
          toggleRegistry.clearIfLatest(entityKey, mutationId);
          return;
        }

        // Rollback optimistic update for latest-sequence errors
        applyOptimisticUpdate(!finalIntent);
        toggleRegistry.clearIfLatest(entityKey, mutationId);
        showToast('Action failed', 'error');
      }
    }, DEBOUNCE_MS);

    pendingTimers.set(entityKey, timerId);
  }, [entityKey, targetUsername, cleanTarget, queryClient, applyOptimisticUpdate]);

  const toggle = useCallback((intentFollow) => {
    if (!entityKey) return;
    // Register intent for UI display (FollowButton reads this via getLatestIntent)
    // Capture the id so cleanup is scoped to THIS mutation — passing
    // activeMutations.get(key) back in compared the value to itself, so a
    // superseded request could clear a newer request's entry.
    const mutationId = toggleRegistry.register(entityKey, intentFollow);

    // Step 1: Instant 0ms optimistic UI update
    applyOptimisticUpdate(intentFollow);

    // Step 2: Schedule debounced HTTP request (coalescing)
    scheduleRequest(intentFollow, mutationId);
  }, [entityKey, applyOptimisticUpdate, scheduleRequest]);

  return {
    follow: () => toggle(true),
    unfollow: () => toggle(false),
    isFollowingLoading: false,
    isUnfollowingLoading: false,
  };
}

