import { useCallback } from 'react';
import { blockIfOffline, OfflineError } from '../lib/offlineGuard';
import { isOnline } from '../lib/networkStatus';

/**
 * Wraps a `useMutation` result so that, offline, the action is refused up
 * front instead of being attempted (see lib/offlineGuard for the rules).
 *
 *   return useGuardedMutation(useMutation({ ... }), 'activity');
 *
 * Refused means: one toast says why, nothing optimistic is applied, no request
 * is made, and the caller is told so the way it is told about any failure:
 *   - `mutateAsync` rejects with an `OfflineError` (a form's own `catch` keeps
 *     the form as it was);
 *   - `mutate` calls the per-call `onError` / `onSettled` it was given, so a
 *     busy flag that those callbacks clear is cleared.
 *
 * `mutate` and `mutateAsync` keep a stable identity, as TanStack's do, because
 * callers put them in dependency arrays.
 */
export function useGuardedMutation(mutation, kind = 'action') {
  const { mutate, mutateAsync } = mutation;

  const guardedMutate = useCallback((variables, options) => {
    if (isOnline()) return mutate(variables, options);
    blockIfOffline(kind);
    const err = new OfflineError(kind);
    options?.onError?.(err, variables, undefined);
    options?.onSettled?.(undefined, err, variables, undefined);
    return undefined;
  }, [mutate, kind]);

  const guardedMutateAsync = useCallback((variables, options) => {
    if (isOnline()) return mutateAsync(variables, options);
    blockIfOffline(kind);
    const error = new OfflineError(kind);
    // Per-call callbacks run as they would for any failure, so a caller that
    // resets a spinner or closes a sheet in onSettled is not left hanging.
    options?.onError?.(error, variables, undefined);
    options?.onSettled?.(undefined, error, variables, undefined);
    return Promise.reject(error);
  }, [mutateAsync, kind]);

  return { ...mutation, mutate: guardedMutate, mutateAsync: guardedMutateAsync };
}
