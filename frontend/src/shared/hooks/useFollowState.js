/**
 * Subscribe to one account's shared follow-state entry.
 *
 * Why this is not `useQuery({ enabled: false })`, which is the obvious way to
 * read a cache entry reactively: a DISABLED query does not re-render its
 * component when `setQueryData` writes to its key. Verified against the
 * version in use here — the observer holds the value it had at mount and never
 * hears about the write. Reading the entry that way would have made the button
 * update only when something else happened to re-render it, which is the same
 * class of "the UI and the truth drift apart" bug this whole change is about.
 *
 * `useSyncExternalStore` over the query cache subscribes to the write itself,
 * so a follow performed anywhere updates every button for that account on the
 * same frame — no fetch, no polling, no prop drilling between surfaces.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient, hashKey } from '@tanstack/react-query';
import { followStateKey } from '@shared/utils/followState';

export function useFollowState(username) {
  const queryClient = useQueryClient();
  const key = followStateKey(username);
  const hash = hashKey(key);

  const subscribe = useCallback(
    (onStoreChange) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event?.query?.queryHash === hash) onStoreChange();
      }),
    [queryClient, hash],
  );

  // `hash` stands in for `key`: it is the key's whole identity, and the array
  // itself is rebuilt on every render, so depending on it directly would give
  // getSnapshot a new identity every time and resubscribe on each render.
  const getSnapshot = useCallback(
    () => queryClient.getQueryData(key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, hash],
  );

  // The value is always a boolean or undefined, so the snapshot is stable by
  // identity and cannot loop.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
