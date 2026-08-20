import { useCallback, useState } from 'react';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { activitiesApi } from '@shared/api/apiClient';
import { idbDelete } from '@shared/lib/idb';

/**
 * Patches all derived membership fields on an activity record.
 * Must update BOTH `members` (raw DB shape) AND `isJoined`/`participants`/`myStatus`
 * (API-layer shape) so every consumer — detail page memo, list cards — reads the
 * correct state immediately without waiting for a cache invalidation + refetch.
 */
function patchActivity(act, intent, currentUser) {
  if (!act || !currentUser) return act;

  let members = act.members || [];
  if (intent && !members.some(m => m.userId === currentUser.id)) {
    members = [
      ...members,
      { userId: currentUser.id, status: 'MEMBER', user: currentUser },
    ];
  } else if (!intent) {
    members = members.filter(m => m.userId !== currentUser.id);
  }

  // ── Preserve the original participants array ──────────────────────────────
  // List-cache items have members:[] but participants:[...all IDs].
  // Reconstructing participants purely from members would wipe out everyone
  // except the current user + creator. Instead, keep the original list and
  // only add/remove the current user, so all other attendees stay intact.
  const origParticipants = (Array.isArray(act.participants) ? act.participants : [])
    .map(p => String(typeof p === 'object' ? (p.id || p.userId || p.user?.id || '') : (p || '')))
    .filter(Boolean);

  let participants;
  if (intent) {
    // Add current user; always keep creator
    participants = Array.from(new Set([
      ...origParticipants,
      String(currentUser.id),
      ...(act.creatorId ? [String(act.creatorId)] : []),
    ]));
  } else {
    // Remove current user; always keep creator
    participants = origParticipants.filter(p => p !== String(currentUser.id));
    if (act.creatorId && !participants.includes(String(act.creatorId))) {
      participants = [String(act.creatorId), ...participants];
    }
  }

  return {
    ...act,
    members,
    participants,
    isJoined: intent,
    myStatus: intent ? 'MEMBER' : null,
  };
}

export function useJoinActivity() {
  const applyOptimistic = useCallback((queryClient, intent, variables) => {
    const { activityId, currentUser } = variables;
    const cleanId = activityId ? String(activityId).replace(/^(act_)+/, '') : activityId;

    // Cancel any in-flight fetches so they don't race back and overwrite the optimistic patch.
    // (staleTime:0 + refetchOnWindowFocus can trigger background refetches at any time.)
    queryClient.cancelQueries({ queryKey: ['activities'] });
    queryClient.cancelQueries({ queryKey: ['activity', cleanId] });
    // Also cancel campus list queries — they share the same activity objects
    queryClient.cancelQueries({ queryKey: ['activities', 'campus'] });
    queryClient.cancelQueries({ queryKey: ['activities', 'me'] });

    // ── 1. Infinite list cache (crew feed) ──────────────────────────────────
    queryClient.setQueriesData({ queryKey: ['activities'] }, (oldData) => {
      if (!oldData) return oldData;

      // Helper to safely compare IDs with or without the act_ prefix
      const matches = (act) => {
        if (!act || !act.id) return false;
        const cleanActId = String(act.id).replace(/^(act_)+/, '');
        return cleanActId === cleanId;
      };

      // InfiniteQuery shape: { pages: [...], pageParams: [...] }
      if (oldData?.pages) {
        return {
          ...oldData,
          pages: oldData.pages.map((page) => {
            const activities = Array.isArray(page?.activities) ? page.activities
              : Array.isArray(page) ? page : null;
            if (!activities) return page;

            const patched = activities.map(act =>
              matches(act) ? patchActivity(act, intent, currentUser) : act
            );
            return Array.isArray(page) ? patched : { ...page, activities: patched };
          }),
        };
      }

      // Flat array shape (some list queries)
      if (Array.isArray(oldData)) {
        return oldData.map(act =>
          matches(act) ? patchActivity(act, intent, currentUser) : act
        );
      }

      // Object wrapper shape (e.g. { activities: [...] } from some list endpoints)
      if (oldData && Array.isArray(oldData.activities)) {
        return {
          ...oldData,
          activities: oldData.activities.map(act =>
            matches(act) ? patchActivity(act, intent, currentUser) : act
          ),
        };
      }

      return oldData;
    });

    // ── 2. Single-activity detail cache ─────────────────────────────────────
    queryClient.setQueryData(['activity', cleanId], (old) => {
      if (!old) return old;
      return patchActivity(old, intent, currentUser);
    });
  }, []);


  const applyRollback = useCallback((queryClient, intent, variables) => {
    applyOptimistic(queryClient, !intent, variables);
  }, [applyOptimistic]);

  const callApi = useCallback(async (intent, signal, variables) => {
    const { activityId } = variables;
    try {
      const result = await (intent
        ? activitiesApi.join(activityId, { signal })
        : activitiesApi.leave(activityId, { signal }));
      // Bust IDB so navigating back to the list never loads stale pre-mutation data
      idbDelete('activities', 'all_page1');
      return result;
    } catch (err) {
      // Swallow benign "already joined / not a member" conflicts — the optimistic
      // state is already correct; treat as a no-op rather than rolling back UI.
      // Only genuinely idempotent conflicts are no-ops. The old code also
      // swallowed every 400, which would hide real refusals like "Activity has
      // already started" or "not authorized" behind a UI that looked successful.
      // (`err.response` was always undefined anyway — apiClient is fetch-based
      // and throws a plain Error, so that branch could never match.)
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('already a member') || msg.includes('not a member')) {
        return; // silent no-op — optimistic state already matches reality
      }
      throw err;
    }
  }, []);

  // Real in-flight tracking so callers can render a "Joining…" state. The
  // registry alone can't drive this: it's a plain Map read during render, so
  // mutating it never schedules a re-render.
  const [pendingIds, setPendingIds] = useState(() => new Set());

  const markSettled = useCallback((_entityKey, variables) => {
    const id = variables?.activityId ? String(variables.activityId).replace(/^(act_)+/, '') : null;
    if (!id) return;
    setPendingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const { mutate: baseMutate } = useToggleMutation({
    entityKey: (vars) => `joinActivity:${vars.activityId}`,
    applyOptimistic,
    applyRollback,
    callApi,
    debounceMs: 100,
    errorMessage: "Couldn't update activity",
    invalidateKeys: (vars) => {
      const cleanId = vars.activityId ? String(vars.activityId).replace(/^(act_)+/, '') : vars.activityId;
      // We can safely invalidate ['activities'] now because the backend
      // `joinActivity` awaits `clearActivityFeedCaches()` BEFORE returning success.
      return [['activities'], ['activity', cleanId]];
    },
    onSettled: markSettled,
  });

  const mutate = useCallback((variables) => {
    const id = variables?.activityId ? String(variables.activityId).replace(/^(act_)+/, '') : null;
    if (id) setPendingIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    baseMutate(variables);
  }, [baseMutate]);

  const isJoinPending = useCallback(
    (activityId) => {
      if (!activityId) return false;
      return pendingIds.has(String(activityId).replace(/^(act_)+/, ''));
    },
    [pendingIds],
  );

  return { mutate, isJoinPending };
}
