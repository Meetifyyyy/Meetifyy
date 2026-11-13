import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { toggleRegistry } from '../utils/mutationRegistry';
import {
  FOLLOW_REQUESTED,
  readFollowState,
  writeOptimisticFollowState,
  writeConfirmedFollowState,
} from '../utils/followState';
import { showToast } from '../utils/toast';
import { blockIfOffline } from '../lib/offlineGuard';
import { requestToggle, isTogglePending } from '../utils/serialToggle';
import { PROFILE_KEYS, persistCachedProfile } from './useProfile';

/**
 * The signed-in user after following (or unfollowing) `targetUsername`, or
 * the same object when nothing changes.
 *
 * Keeps `followingCount`, which the session carries since ID-16, in step with
 * `followingList`, so neither goes stale before the next sync. A server that
 * predates the count sends none, and none is invented here.
 */
export function withFollowApplied(currentUser, targetUsername, isFollowing) {
  const cleanTarget = targetUsername?.toLowerCase();
  const currentList = Array.isArray(currentUser?.followingList) ? currentUser.followingList : [];
  const listed = currentList.some((u) => u?.toLowerCase() === cleanTarget);
  if (isFollowing === listed) return currentUser;

  const followingList = isFollowing
    ? [...currentList, targetUsername]
    : currentList.filter((u) => u?.toLowerCase() !== cleanTarget);
  const next = { ...currentUser, followingList };
  if (typeof currentUser.followingCount === 'number') {
    next.followingCount = Math.max(0, currentUser.followingCount + (isFollowing ? 1 : -1));
  }
  return next;
}

/**
 * The follow state the server reports after a follow or unfollow.
 *
 * `requested: true` is a private account holding the viewer's request: no
 * follow was written. A response with neither field (an older server) is read
 * as having done what was asked.
 */
function serverFollowState(target, res) {
  if (res?.requested === true) return FOLLOW_REQUESTED;
  if (typeof res?.isFollowing === 'boolean') return res.isFollowing;
  return target;
}

/**
 * What the shared follow state held when each in-progress burst of taps began,
 * per account. A failed unfollow has to put back WHICH "on" it was (Following
 * or Requested), and by then the optimistic writes have overwritten it.
 */
const burstOrigins = new Map();

/**
 * Follow / unfollow:
 * 1. Instant optimistic UI on every tap.
 * 2. Requests ordered through serialToggle: one in flight per account, never
 *    aborted, at most one follow-up per burst. It used to abort the in-flight
 *    request and send the opposite one, but the server had usually received
 *    the first already, so both ran in whichever order they landed.
 * 3. The server's own answer is written as confirmed state once the burst
 *    settles; a failure restores the state the server actually holds.
 * 4. Three states, one toggle. A tap means "on" or "off"; what "on" becomes is
 *    the account's privacy: Following, or Requested for a private account.
 *    When the target's privacy is already cached the tap shows the right one
 *    at once; when it is not, the tap shows Following and settles to what the
 *    server says (it never passes through "Follow").
 */
export function useFollowMutation(targetUsername) {
  const { currentUser, updateCurrentUser } = useAuth();
  const queryClient = useQueryClient();

  const cleanTarget = targetUsername?.toLowerCase();
  const cleanCurrent = currentUser?.username?.toLowerCase();
  const entityKey = `follow:${cleanTarget}`;

  /**
   * `next` is the state to show: `true` (following), `'requested'` or `false`.
   * Only `true` is a follow: a request changes no follower or following count,
   * no list of who follows whom and no `followingList`.
   */
  const applyOptimisticUpdate = useCallback((next) => {
    if (!cleanTarget) return;
    const isFollowing = next === true;
    const requested = next === FOLLOW_REQUESTED;
    // Read BEFORE the write below replaces it: whether the viewer followed
    // this account until now decides the count changes. Unknown means "the
    // opposite of what was asked" for an unfollow, as it always has.
    const before = readFollowState(queryClient, cleanTarget);
    const wasFollowing = before === undefined ? next === false : before === true;
    const followingDelta = Number(isFollowing) - Number(wasFollowing);

    // The shared follow-state entry FIRST. Every button for this account reads
    // it, so this is what makes Follow → Following happen on the same frame,
    // wherever that account is rendered — sidebar, search results, profile
    // header — without any of them refetching.
    writeOptimisticFollowState(queryClient, cleanTarget, next);

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
      u && u.username?.toLowerCase() === cleanTarget
        ? {
            ...u,
            isFollowing,
            ...(requested || 'followRequested' in u ? { followRequested: requested } : {}),
          }
        : u;
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

    // Synchronize AuthContext's currentUser immediately
    if (currentUser && targetUsername) {
      const next = withFollowApplied(currentUser, targetUsername, isFollowing);
      if (next !== currentUser) updateCurrentUser(next);
    }

    // Target profile by username
    queryClient.setQueryData(PROFILE_KEYS.byUsername(cleanTarget), (old) => {
      if (!old) return old;
      const currentFollowers = old.stats?.followers ?? old.followersCount ?? old.followersList?.length ?? 0;
      const currentlyFollowing = Boolean(old.isFollowing);
      const delta = Number(isFollowing) - Number(currentlyFollowing);
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
        followRequested: requested,
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
        const delta = Number(isFollowing) - Number(currentlyFollowing);
        const newFollowers = Math.max(0, currentFollowers + delta);
        return {
          ...u,
          isFollowing,
          ...(requested || 'followRequested' in u ? { followRequested: requested } : {}),
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

    // Current user's following count. Not touched by a request, or by
    // withdrawing one: neither changes who the viewer follows.
    if (cleanCurrent && followingDelta !== 0) {
      queryClient.setQueryData(PROFILE_KEYS.byUsername(cleanCurrent), (old) => {
        if (!old) return old;
        const currentFollowing = old.stats?.following ?? old.followingCount ?? old.followingList?.length ?? 0;
        const delta = followingDelta;
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

  /** The burst has settled on `serverState` (`true`, `'requested'` or `false`): record it and mark lists stale. */
  const reconcile = useCallback((serverState) => {
    // Confirmed, not merely observed: this response IS the write. It
    // re-stamps the per-account clock so any list payload still in flight
    // from before the action cannot land on top of it.
    writeConfirmedFollowState(queryClient, cleanTarget, serverState);

    // Keep the copy IndexedDB rehydrates from in step with the in-memory
    // profiles the taps just updated (the target's follow state and follower
    // count, the viewer's own following count). Without this a reload paints
    // the pre-tap copy first.
    persistCachedProfile(queryClient, cleanTarget);
    persistCachedProfile(queryClient, cleanCurrent);

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

  const toggle = useCallback((intentOn) => {
    if (!entityKey || !cleanTarget) return;
    // Offline: not applied (see lib/offlineGuard), so Follow stays Follow.
    if (blockIfOffline('action')) return;
    // Where this burst of taps started, for a failure to restore. Read before
    // the optimistic write below replaces it.
    if (!isTogglePending(entityKey)) {
      burstOrigins.set(entityKey, readFollowState(queryClient, cleanTarget));
    }
    // What "on" looks like for this account: Requested when its profile is
    // already known to be private, otherwise Following until the server says
    // (a wrong guess is corrected when the response lands, never via "Follow").
    const cachedProfile = queryClient.getQueryData(PROFILE_KEYS.byUsername(cleanTarget));
    const isPrivateTarget =
      cachedProfile?.isPrivate === true || cachedProfile?.settings?.privateProfile === true;
    const optimistic = intentOn ? (isPrivateTarget ? FOLLOW_REQUESTED : true) : false;

    // Register intent for UI display (FollowButton reads this via
    // getLatestIntent). The intent is on/off only; the kind of "on" lives in
    // the shared follow state. The id scopes the release to THIS tap, so an
    // older one can never clear a newer one's entry.
    const mutationId = toggleRegistry.register(entityKey, intentOn);
    applyOptimisticUpdate(optimistic);

    requestToggle(entityKey, intentOn, {
      send: (target) => (target ? usersApi.follow(targetUsername) : usersApi.unfollow(targetUsername)),
      onConfirmed: (target, res, isFinal) => {
        if (!isFinal) return;
        burstOrigins.delete(entityKey);
        // Release the pending intent BEFORE writing server state: while the
        // registry still holds an entry for this key, writeServerFollowState
        // deliberately declines to write.
        toggleRegistry.clearIfLatest(entityKey, mutationId);
        const serverState = serverFollowState(target, res);
        // The tap guessed Following and the account is private (or the other
        // way round): move the counts and lists to what actually happened.
        if (readFollowState(queryClient, cleanTarget) !== serverState) {
          applyOptimisticUpdate(serverState);
        }
        reconcile(serverState);
      },
      onFailed: (_err, { confirmed, lastResponse }) => {
        toggleRegistry.clearIfLatest(entityKey, mutationId);
        const origin = burstOrigins.get(entityKey);
        burstOrigins.delete(entityKey);
        // What the server still holds: nothing if no request ever landed
        // (confirmed is off); else what the last one reported, or, if none
        // did, what the burst started from.
        let held = false;
        if (confirmed) {
          held = lastResponse !== undefined
            ? serverFollowState(true, lastResponse)
            : (origin === FOLLOW_REQUESTED ? FOLLOW_REQUESTED : true);
        }
        if (readFollowState(queryClient, cleanTarget) !== held) applyOptimisticUpdate(held);
        // The rollback is a write to the same profiles; keep the saved copy honest too.
        persistCachedProfile(queryClient, cleanTarget);
        persistCachedProfile(queryClient, cleanCurrent);
        showToast('Action failed', 'error');
      },
    });
  }, [entityKey, cleanTarget, cleanCurrent, targetUsername, queryClient, applyOptimisticUpdate, reconcile]);

  return {
    follow: () => toggle(true),
    unfollow: () => toggle(false),
    isFollowingLoading: false,
    isUnfollowingLoading: false,
  };
}

