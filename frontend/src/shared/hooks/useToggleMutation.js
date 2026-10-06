/**
 * useToggleMutation — the shared on/off action (save, community join,
 * activity join).
 *
 * Guarantees:
 *  1. Instant optimistic UI on every tap.
 *  2. Requests reach the server in the order the person acted: one in flight
 *     per entity, never aborted, with at most one follow-up for a burst of
 *     taps. See serialToggle.js for why aborting was the bug.
 *  3. A failure restores the state the server actually holds — not "the
 *     opposite of the last tap", which after a burst can be wrong.
 *  4. One background invalidation, only once the burst has settled.
 */
import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toggleRegistry } from '../utils/mutationRegistry';
import { requestToggle } from '../utils/serialToggle';
import { showToast } from '../utils/toast';

function invalidateAfterSettle(queryClient, invalidateKeys) {
  // Each entry is either a plain query key (refetched immediately on every
  // mounted observer) or `{ queryKey, refetchType }`.
  //
  // The per-key form exists because "invalidate" and "rebuild the list the
  // user is looking at" are not the same request. A discovery list is ordered
  // by member count, and joining increments it — so an active refetch
  // re-sorted the list under the cursor the moment the action succeeded.
  // Those keys ask for `refetchType: 'none'`: the entry is marked stale and
  // refreshed the next time it is mounted, while the optimistic write keeps
  // the visible card correct in the meantime.
  invalidateKeys.forEach((entry) => {
    const isDescriptor = entry && !Array.isArray(entry) && typeof entry === 'object';
    const queryKey = isDescriptor ? entry.queryKey : entry;
    const refetchType = isDescriptor ? (entry.refetchType ?? 'active') : 'active';
    if (!queryKey) return;
    queryClient.invalidateQueries({ queryKey, refetchType });
  });
}

/**
 * `invalidateKeys` accepts either a query key array or
 * `{ queryKey, refetchType }` — see invalidateAfterSettle.
 *
 * `applyRollback(queryClient, intent, variables)` must undo exactly one
 * `applyOptimistic(queryClient, intent, variables)`; it is called only when
 * the screen shows a state the server does not hold.
 */
export function useToggleMutation({
  entityKey: getEntityKey,
  applyOptimistic,
  applyRollback,
  callApi,
  invalidateKeys = [],
  errorMessage = 'Action failed',
  onSettled,
}) {
  const queryClient = useQueryClient();
  // Latest options, so an in-flight burst reports to the newest render.
  const optsRef = useRef(null);
  optsRef.current = { applyRollback, callApi, invalidateKeys, errorMessage, onSettled };

  const mutate = useCallback((variables) => {
    const entityKey = getEntityKey(variables);
    const intent = variables.intentState ?? variables.isLiked ?? variables.isSaved ?? variables.isFollowing ?? variables.isJoined;

    // Register so the UI reads the latest intent via toggleRegistry while the
    // burst is pending; the id scopes the release to this tap.
    const mutationId = toggleRegistry.register(entityKey, intent);
    applyOptimistic(queryClient, intent, variables);

    const release = () => {
      if (toggleRegistry.clearIfLatest(entityKey, mutationId)) {
        optsRef.current.onSettled?.(entityKey, variables);
      }
    };

    requestToggle(entityKey, intent, {
      send: (target) => optsRef.current.callApi(target, undefined, variables),
      onConfirmed: (_target, _res, isFinal) => {
        if (!isFinal) return;
        release();
        const keys = optsRef.current.invalidateKeys;
        invalidateAfterSettle(queryClient, typeof keys === 'function' ? keys(variables) : keys);
      },
      onFailed: (_err, { desired, confirmed }) => {
        release();
        if (desired !== confirmed) optsRef.current.applyRollback(queryClient, desired, variables);
        showToast(optsRef.current.errorMessage);
      },
    });
  }, [getEntityKey, queryClient, applyOptimistic]);

  return { mutate };
}
