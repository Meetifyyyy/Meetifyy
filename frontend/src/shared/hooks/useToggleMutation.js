/**
 * useToggleMutation — Reusable production-grade coalescing toggle hook.
 *
 * Shared by every toggle action in the app (Like, Save, Follow, Join, etc.).
 *
 * Guarantees:
 *  1. Instant 0ms optimistic UI on every click.
 *  2. Request coalescing — debounces rapid clicks into ONE network request.
 *  3. AbortController — cancels in-flight requests when user intent flips.
 *  4. Mutation versioning — stale responses never update UI or cache.
 *  5. One silent background refetch only after the FINAL request settles.
 *  6. Stale errors are silently swallowed — never roll back a newer intent.
 */
import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toggleRegistry } from '../utils/mutationRegistry';
import { showToast } from '../utils/toast';

// Module-level stores — persist across renders without causing re-renders.
// Keyed by entityKey (e.g. "likePost:abc123")
const _controllers = new Map();  // entityKey -> AbortController
const _timers      = new Map();  // entityKey -> setTimeout id
const _intents     = new Map();  // entityKey -> latest boolean intent

const DEBOUNCE_MS = 280;

function scheduleCoalescedRequest({
  entityKey,
  intent,
  variables,
  queryClient,
  applyOptimistic,
  applyRollback,
  callApi,
  invalidateKeys = [],
  errorMessage = 'Action failed',
  debounceMs = DEBOUNCE_MS,
  seqRef,
}) {
  // Cancel pending timer
  if (_timers.has(entityKey)) {
    clearTimeout(_timers.get(entityKey));
  }

  // Abort in-flight request
  if (_controllers.has(entityKey)) {
    _controllers.get(entityKey).abort();
    _controllers.delete(entityKey);
  }

  // Track latest intent
  _intents.set(entityKey, intent);

  const timerId = setTimeout(async () => {
    _timers.delete(entityKey);

    const finalIntent = _intents.get(entityKey);
    _intents.delete(entityKey);

    const seq = ++seqRef.current;
    const controller = new AbortController();
    _controllers.set(entityKey, controller);

    try {
      await callApi(finalIntent, controller.signal, variables);

      if (seq === seqRef.current) {
        _controllers.delete(entityKey);
        // Clear the registry entry now that the final request settled
        toggleRegistry.clearIfLatest(entityKey, toggleRegistry.activeMutations.get(entityKey));
        // Active refetch — triggers immediate background sync on all mounted queries
        invalidateKeys.forEach(key => {
          queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' });
        });
      }
    } catch (err) {
      _controllers.delete(entityKey);

      // Aborted = newer request took over, ignore silently
      if (err?.name === 'AbortError' || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;

      // Stale sequence = newer request completed, ignore silently
      if (seq !== seqRef.current) return;

      // Latest request failed — roll back optimistic update and clear registry
      toggleRegistry.clearIfLatest(entityKey, toggleRegistry.activeMutations.get(entityKey));
      applyRollback(queryClient, finalIntent);
      showToast(errorMessage);
    }
  }, debounceMs);

  _timers.set(entityKey, timerId);
}

/**
 * useToggleMutation
 */
export function useToggleMutation({
  entityKey: getEntityKey,
  applyOptimistic,
  applyRollback,
  callApi,
  invalidateKeys = [],
  errorMessage = 'Action failed',
  debounceMs = DEBOUNCE_MS,
}) {
  const queryClient = useQueryClient();
  const seqRefs = useRef({}); // map of entityKey -> sequence number

  const mutate = useCallback((variables) => {
    const entityKey = getEntityKey(variables);
    const intent = variables.intentState ?? variables.isLiked ?? variables.isSaved ?? variables.isFollowing ?? variables.isJoined;

    // Get or initialize sequence number for this specific entityKey
    if (!seqRefs.current[entityKey]) {
      seqRefs.current[entityKey] = { current: 0 };
    }
    const seqRef = seqRefs.current[entityKey];

    // Register intent so UI reads latest intent via toggleRegistry.getLatestIntent()
    toggleRegistry.register(entityKey, intent);

    // Instant 0ms optimistic update
    applyOptimistic(queryClient, intent, variables);

    // Debounced + coalesced network call
    scheduleCoalescedRequest({
      entityKey,
      intent,
      variables,
      queryClient,
      applyOptimistic: (qc, val) => applyOptimistic(qc, val, variables),
      applyRollback: (qc, val) => applyRollback(qc, val, variables),
      callApi: (val, signal, vars) => callApi(val, signal, vars ?? variables),
      invalidateKeys: typeof invalidateKeys === 'function' ? invalidateKeys(variables) : invalidateKeys,
      errorMessage,
      debounceMs,
      seqRef,
    });
  }, [getEntityKey, queryClient, applyOptimistic, applyRollback, callApi, invalidateKeys, errorMessage, debounceMs]);

  return { mutate };
}
