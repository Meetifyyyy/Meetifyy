import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { toggleRegistry } from '../utils/mutationRegistry';
import { showToast } from '../utils/toast';

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
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const mutationSeqRef = useRef(0);
  const entityKey = `follow:${targetUsername}`;

  const applyOptimisticUpdate = useCallback((isFollowing) => {
    // Target profile
    queryClient.setQueryData(['profile', targetUsername], (old) => {
      if (!old) return old;
      return {
        ...old,
        isFollowing,
        followersCount: Math.max(0, (old.followersCount ?? old.stats?.followers ?? 0) + (isFollowing ? 1 : -1)),
        stats: old.stats ? {
          ...old.stats,
          followers: Math.max(0, (old.stats.followers ?? 0) + (isFollowing ? 1 : -1)),
        } : old.stats,
      };
    });

    // Current user's following count
    queryClient.setQueryData(['profile', currentUser?.username], (old) => {
      if (!old) return old;
      return {
        ...old,
        stats: old.stats ? {
          ...old.stats,
          following: Math.max(0, (old.stats.following ?? 0) + (isFollowing ? 1 : -1)),
        } : old.stats,
      };
    });
  }, [queryClient, targetUsername, currentUser?.username]);

  const scheduleRequest = useCallback((intentFollow) => {
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
        if (finalIntent) {
          await usersApi.follow(targetUsername, { signal: controller.signal });
        } else {
          await usersApi.unfollow(targetUsername, { signal: controller.signal });
        }

        // Only reconcile if this is still the latest sequence
        if (seq === mutationSeqRef.current) {
          activeControllers.delete(entityKey);
          toggleRegistry.clearIfLatest(entityKey, toggleRegistry.activeMutations.get(entityKey));
          // ONE silent background sync — does not update UI (staleTime guard prevents flicker)
          queryClient.invalidateQueries({ queryKey: ['profile', targetUsername], refetchType: 'none' });
        }
      } catch (err) {
        activeControllers.delete(entityKey);
        // If aborted, it means a newer request took over — don't do anything
        if (err?.name === 'AbortError' || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        // If this isn't the latest sequence, swallow the error silently
        if (seq !== mutationSeqRef.current) return;

        // Rollback optimistic update for latest-sequence errors
        applyOptimisticUpdate(!finalIntent);
        showToast('Something went wrong. Please try again.');
      }
    }, DEBOUNCE_MS);

    pendingTimers.set(entityKey, timerId);
  }, [entityKey, targetUsername, queryClient, applyOptimisticUpdate]);

  const toggle = useCallback((intentFollow) => {
    // Register intent for UI display (FollowButton reads this via getLatestIntent)
    toggleRegistry.register(entityKey, intentFollow);

    // Step 1: Instant 0ms optimistic UI update
    applyOptimisticUpdate(intentFollow);

    // Step 2: Schedule debounced HTTP request (coalescing)
    scheduleRequest(intentFollow);
  }, [entityKey, applyOptimisticUpdate, scheduleRequest]);

  return {
    follow: () => toggle(true),
    unfollow: () => toggle(false),
    isFollowingLoading: false,
    isUnfollowingLoading: false,
  };
}
