import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toggleRegistry } from '../utils/mutationRegistry';
import { showToast } from '../utils/toast';

/**
 * A robust wrapper around useMutation designed specifically for toggle-based actions 
 * (Like, Save, Follow, Join). It integrates with mutationRegistry to prevent race 
 * conditions during rapid toggling, ensuring out-of-order errors/successes 
 * don't overwrite newer optimistic UI states.
 * 
 * @param {Object} options
 * @param {Function} options.mutationKey - Function returning a unique string for the entity (e.g. (vars) => `likePost:${vars.postId}`)
 * @param {Function} options.mutationFn - The API call function
 * @param {Function} options.onMutate - Optimistic update logic. MUST return a rollback function.
 * @param {Function} [options.onError] - Optional custom error handler
 * @param {Function} [options.onSuccess] - Optional custom success handler (usually invalidateQueries)
 * @param {string} [options.errorMessage] - Custom error message for toast
 */
export function useRobustToggle({
  mutationKey,
  mutationFn,
  onMutate: customOnMutate,
  onError: customOnError,
  onSuccess: customOnSuccess,
  errorMessage = 'Something went wrong. Please try again.',
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      const entityKey = mutationKey(variables);
      const intentState = variables?.intentState ?? variables?.isLiked ?? variables?.isSaved ?? variables?.isFollowing ?? variables?.isJoined;
      const mutationId = toggleRegistry.register(entityKey, intentState);
      
      const rollback = await customOnMutate(variables, queryClient);
      
      return { entityKey, mutationId, rollback };
    },
    onError: (err, variables, context) => {
      // If this mutation was superseded by a newer one, ignore the error silently
      if (context && !toggleRegistry.isLatest(context.entityKey, context.mutationId)) {
        console.debug(`[RobustToggle] Ignoring stale error for ${context.entityKey}`);
        return;
      }
      
      if (context?.rollback) {
        context.rollback();
      }
      
      if (customOnError) {
        customOnError(err, variables, context);
      }
      
      showToast(errorMessage);
    },
    onSuccess: (data, variables, context) => {
      // If this mutation was superseded by a newer one, ignore the success silently
      if (context && !toggleRegistry.isLatest(context.entityKey, context.mutationId)) {
        console.debug(`[RobustToggle] Ignoring stale success for ${context.entityKey}`);
        return;
      }
      
      if (customOnSuccess) {
        customOnSuccess(data, variables, queryClient);
      }
    },
    onSettled: (data, err, variables, context) => {
      // Clean up registry if this is the final/latest mutation settling
      if (context && toggleRegistry.isLatest(context.entityKey, context.mutationId)) {
        toggleRegistry.clearIfLatest(context.entityKey, context.mutationId);
      }
    }
  });
}
