import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export const useOptimisticMutation = ({
  mutationFn,
  onMutate,
  onSuccess,
  onError,
}) => {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const mutate = useCallback(async (variables) => {
    setIsLoading(true);
    setError(null);

    // Call onMutate and expect it to return a rollback function or snapshot data
    let snapshotOrRollback = null;
    if (onMutate) {
      snapshotOrRollback = await onMutate(variables, queryClient);
    }

    try {
      const result = await mutationFn(variables);
      
      if (onSuccess) {
        onSuccess(result, variables, queryClient);
      }
      
      setIsLoading(false);
      return result;
    } catch (err) {
      setError(err);
      
      if (onError) {
        onError(err, variables, snapshotOrRollback, queryClient);
      } else if (typeof snapshotOrRollback === 'function') {
        // If onMutate returned a rollback function, call it
        snapshotOrRollback();
      }
      
      setIsLoading(false);
      throw err;
    }
  }, [mutationFn, onMutate, onSuccess, onError, queryClient]);

  return { mutate, isLoading, error };
};
