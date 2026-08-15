import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toggleRegistry } from '../utils/mutationRegistry';
import { showToast } from '../utils/toast';

/**
 * A wrapper around useMutation that standardizes optimistic updates and rollbacks.
 *
 * @param {Object} options
 * @param {Function} options.mutationFn - The API call function.
 * @param {Function} [options.mutationKey] - Optional function returning a unique string for the entity (e.g. (vars) => `follow:${vars.username}`)
 * @param {Array<string[]>} options.queryKeys - Array of query keys to cancel and rollback.
 * @param {Function} options.onOptimisticUpdate - Function that applies optimistic updates to the cache. Receives queryClient.
 * @param {Function} [options.onSuccess] - Additional success handler.
 * @param {Function} [options.onError] - Additional error handler.
 * @param {string} [options.errorMessage] - Custom error message for toast.
 */
export function useOptimisticMutation({
  mutationFn,
  mutationKey,
  queryKeys,
  onOptimisticUpdate,
  onSuccess,
  onError,
  errorMessage = 'Action failed',
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      // 1. Register intent if mutationKey is provided
      const entityKey = mutationKey ? mutationKey(variables) : null;
      const mutationId = entityKey ? toggleRegistry.register(entityKey) : null;

      // 2. Cancel any outgoing refetches so they don't overwrite our optimistic update
      const cancelPromises = queryKeys.map((key) => queryClient.cancelQueries({ queryKey: key }));
      await Promise.all(cancelPromises);

      // 3. Snapshot the previous value
      const previousState = {};
      queryKeys.forEach((key) => {
        previousState[JSON.stringify(key)] = queryClient.getQueryData(key);
      });

      // 4. Optimistically update to the new value
      if (onOptimisticUpdate) {
        onOptimisticUpdate(queryClient, variables);
      }

      // 5. Return context with snapshot
      return { previousState, entityKey, mutationId };
    },
    onError: (err, variables, context) => {
      // Check if stale
      if (context?.entityKey && !toggleRegistry.isLatest(context.entityKey, context.mutationId)) {
        console.debug(`[OptimisticMutation] Ignoring stale error for ${context.entityKey}`);
        return;
      }

      // Rollback cache to snapshot
      if (context?.previousState) {
        queryKeys.forEach((key) => {
          const snapshot = context.previousState[JSON.stringify(key)];
          if (snapshot !== undefined) {
            queryClient.setQueryData(key, snapshot);
          }
        });
      }
      showToast(errorMessage);
      if (onError) onError(err, variables, context);
    },
    onSettled: (data, error, variables, context) => {
      // Check if stale (for onSuccess behavior)
      if (context?.entityKey && !toggleRegistry.isLatest(context.entityKey, context.mutationId)) {
        return;
      }

      // Invalidate to ensure we are always in sync with the server
      queryKeys.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: key });
      });
      if (data && onSuccess) onSuccess(data, variables, context);

      // Cleanup
      if (context?.entityKey && toggleRegistry.isLatest(context.entityKey, context.mutationId)) {
        toggleRegistry.clearIfLatest(context.entityKey, context.mutationId);
      }
    },
  });
}
