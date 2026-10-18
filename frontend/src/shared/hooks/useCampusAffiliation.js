import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { campusAffiliationApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { dropCampusCaches } from '@shared/lib/campusCache';
import {
  CAMPUS_AFFILIATION_QUERY_KEY,
  hasAffiliationField,
  isAffiliationActive,
  isCampusAffiliationError,
  legacyCampusAccess,
} from '@shared/lib/campusAccess';

/** Marker for "this API has no affiliation endpoint" (an older backend). */
const LEGACY = Object.freeze({ legacy: true, affiliation: null, pending: null });

async function fetchAffiliation() {
  try {
    const res = await campusAffiliationApi.get();
    return {
      legacy: false,
      affiliation: res?.affiliation ?? null,
      pending: res?.pending ?? null,
    };
  } catch (err) {
    if (err?.status === 404) return LEGACY;
    throw err;
  }
}

/**
 * The viewer's college affiliation, and whether it opens Campus.
 *
 * Reads `currentUser.campusAffiliation` when the API sends it (the session,
 * the socket and the verify response keep it current). Asks
 * `GET /api/campus/affiliation` when:
 *   - the user object has no such key (an API that predates it, or a profile
 *     cached before it existed), or
 *   - `withPending` is set and there is no active affiliation: a code sent
 *     before a reload or an app restart is restored from the server, never
 *     from local storage.
 *
 * `status` is 'loading' | 'active' | 'none'. It stays 'loading' while the
 * signed-in user is only the device's saved copy (`profileFromCache`).
 */
export function useCampusAffiliation({ withPending = false } = {}) {
  const { currentUser, isLoggedIn, profileFromCache } = useAuth();
  const userId = currentUser?.id;
  const known = hasAffiliationField(currentUser);
  const userAffiliation = known ? currentUser.campusAffiliation : null;
  const activeFromUser = isAffiliationActive(userAffiliation);

  const needsFetch = Boolean(isLoggedIn && userId) && (!known || (withPending && !activeFromUser));

  const query = useQuery({
    queryKey: [...CAMPUS_AFFILIATION_QUERY_KEY, userId],
    queryFn: fetchAffiliation,
    enabled: needsFetch,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });

  const data = needsFetch ? query.data : undefined;

  let affiliation = userAffiliation;
  let status;
  let legacy = false;
  if (!currentUser) {
    status = 'none';
  } else if (known) {
    // The server's answer is fresher than the cached user when we have both.
    if (data && !data.legacy && data.affiliation !== undefined) affiliation = data.affiliation;
    status = isAffiliationActive(affiliation) ? 'active' : 'none';
    if (activeFromUser) status = 'active';
  } else if (needsFetch && query.isLoading) {
    status = 'loading';
  } else if (data && !data.legacy) {
    affiliation = data.affiliation;
    status = isAffiliationActive(affiliation) ? 'active' : 'none';
  } else {
    // An older API (404), or the check failed: fall back to the old rule so a
    // frontend deployed ahead of its backend does not lock anyone out. The
    // server still refuses whatever it refuses.
    legacy = true;
    status = legacyCampusAccess(currentUser) ? 'active' : 'none';
  }

  // The user is the copy this device saved, and the server has not answered
  // for it yet (the boot check was offline or rate-limited). A cached
  // `active` is not authority to show — or to restore from IndexedDB — a
  // college's lists the affiliation may since have lost, so Campus stays in
  // its neutral loading state until the session is confirmed. An answer from
  // the affiliation endpoint itself is the server's, and counts.
  if (currentUser && profileFromCache && !(data && !data.legacy)) {
    status = 'loading';
    legacy = false;
  }

  return {
    status,
    isActive: status === 'active',
    isLoading: status === 'loading',
    affiliation: affiliation || null,
    pending: status === 'active' ? null : data?.pending || null,
    legacy,
    isPendingLoading: Boolean(needsFetch && query.isLoading),
    refetch: query.refetch,
  };
}

/** Just the boolean, for a query's `enabled`. */
export function useHasCampusAccess() {
  return useCampusAffiliation().isActive;
}

let lastDeniedRefreshAt = 0;
const DENIED_REFRESH_INTERVAL_MS = 10 * 1000;

/**
 * Returns a function campus queries call with their error. A 403
 * `campus_affiliation_required` means the cached affiliation is stale (it was
 * removed or revoked elsewhere), so every cached campus list is dropped and
 * the session is re-read — once per ten
 * seconds at most, however many campus queries fail together.
 */
export function useCampusDeniedHandler() {
  const { refreshCurrentUser } = useAuth();
  const queryClient = useQueryClient();
  return useCallback(
    (err) => {
      if (!isCampusAffiliationError(err)) return;
      const now = Date.now();
      if (now - lastDeniedRefreshAt < DENIED_REFRESH_INTERVAL_MS) return;
      lastDeniedRefreshAt = now;
      // The cached campus lists (in memory and in the IndexedDB mirrors)
      // belong to an affiliation the server no longer honours: drop them
      // before the session is re-read, so nothing of the old college shows.
      // dropCampusCaches also invalidates the affiliation query.
      dropCampusCaches(queryClient);
      Promise.resolve(refreshCurrentUser?.()).catch(() => {});
    },
    [refreshCurrentUser, queryClient],
  );
}
