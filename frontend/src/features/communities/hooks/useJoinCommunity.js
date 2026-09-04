import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { communitiesApi } from '@shared/api/apiClient';
import { COMMUNITY_KEYS } from '@shared/hooks/useCommunities';
import { idbDelete } from '@shared/lib/idb';
import { isCommunityOwner } from '@shared/utils/community';
import { showToast } from '@shared/utils/toast';
import { openVerificationModal } from '@shared/stores/verificationModalStore';

export function useJoinCommunity() {
  const applyOptimistic = useCallback((queryClient, intent, variables) => {
    const { communityId, currentUser } = variables;
    const updater = (oldData) => {
      if (!oldData) return oldData;
      const update = (c) => {
        if (c.id !== communityId) return c;
        const current = c.memberCount || c.membersCount || 0;
        const newCount = Math.max(0, current + (intent ? 1 : -1));
        return { ...c, isMember: intent, isJoined: intent, memberCount: newCount, membersCount: newCount };
      };
      if (Array.isArray(oldData)) return oldData.map(update);
      return oldData;
    };

    // Every cache entry under the ['communities'] prefix, in one pass — the
    // full list, the campus list and the discovery recommendations alike.
    //
    // This used to name two exact keys, which meant each new community list
    // had to remember to add itself here or its cards would show the wrong
    // membership after a join: the toggle registry's pending intent carries
    // the button for about fifteen seconds, and once it expires the card falls
    // back to the payload and reads "Join" again for somewhere the viewer had
    // just joined. A prefix match cannot drift that way.
    //
    // (An earlier version wrote the campus list to ['campusCommunities'],
    // which is not a key any query has ever used, so joining a campus
    // community never updated that list at all.)
    queryClient.setQueriesData({ queryKey: COMMUNITY_KEYS.all }, updater);

    queryClient.setQueryData(COMMUNITY_KEYS.byId(communityId), (old) => {
      if (!old) return old;
      const current = old.memberCount || old.membersCount || 0;
      const newCount = Math.max(0, current + (intent ? 1 : -1));
      let members = old.members || [];
      if (intent && currentUser && !members.some(m => (m.userId || m.id || m.user?.id) === currentUser.id)) {
        members = [...members, { userId: currentUser.id, role: 'MEMBER', user: currentUser }];
      } else if (!intent && currentUser) {
        members = members.filter(m => (m.userId || m.id || m.user?.id) !== currentUser.id);
      }
      return { ...old, isMember: intent, isJoined: intent, memberCount: newCount, membersCount: newCount, members };
    });
  }, []);

  const applyRollback = useCallback((queryClient, intent, variables) => {
    applyOptimistic(queryClient, !intent, variables);
  }, [applyOptimistic]);

  const callApi = useCallback((intent, signal, variables) => {
    const { communityId } = variables;
    return intent
      ? communitiesApi.join(communityId, { signal })
      : communitiesApi.leave(communityId, { signal });
  }, []);

  const isOwner = useCallback((queryClient, variables) => {
    const { communityId, currentUser } = variables;
    if (!currentUser?.id) return false;
    // The detail cache is the most reliable read; fall back to the list.
    const detail = queryClient.getQueryData(COMMUNITY_KEYS.byId(communityId));
    if (detail) return isCommunityOwner(detail, currentUser);
    const lists = [
      queryClient.getQueryData(COMMUNITY_KEYS.all),
      queryClient.getQueryData(COMMUNITY_KEYS.campus),
    ];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      const found = list.find((c) => c?.id === communityId);
      if (found) return isCommunityOwner(found, currentUser);
    }
    return false;
  }, []);

  /**
   * The community lists are mirrored into IndexedDB for instant first paint,
   * and that mirror carries per-viewer membership. Nothing dropped it when a
   * join or leave succeeded, so the next cold start could rehydrate the
   * pre-action rows — a community the viewer had joined coming back as "Join"
   * after a reload. Query invalidation cannot fix that: the invalidated flag
   * does not survive a page load, but the mirror does.
   */
  const dropListMirror = useCallback(() => {
    idbDelete('communities', 'all').catch(() => {});
    idbDelete('communities', 'campus').catch(() => {});
  }, []);

  const { mutate: toggle } = useToggleMutation({
    entityKey: (vars) => `joinCommunity:${vars.communityId}`,
    applyOptimistic,
    applyRollback,
    callApi,
    // `['communities']` covers the campus list too — its key is
    // ['communities','campus']. The old list also named ['campusCommunities'],
    // which no query has ever used.
    //
    // Marked stale but NOT refetched: these lists are ordered by member count,
    // which the join just changed, so refetching them re-sorted the discovery
    // panel the moment the button was pressed and could move or replace the
    // card the viewer had just acted on. The optimistic write above already
    // holds the correct membership and count for the visible cards; the list
    // itself is regenerated on the next mount or reload, which is where a
    // joined community is expected to make way for a new suggestion.
    //
    // The community's own detail page is refetched actively — it is showing
    // the member list this action changed, and it is not a ranked list.
    invalidateKeys: (vars) => [
      { queryKey: ['communities'], refetchType: 'none' },
      ['community', vars.communityId],
      ['conversations'],
    ],
    onSettled: dropListMirror,
  });

  const queryClient = useQueryClient();

  /**
   * Leaving is refused for the owner before any request is made.
   *
   * Every surface should hide the control for them, but this is the one place
   * all of them funnel through — and the server's rejection would otherwise
   * arrive after the optimistic update had already removed them from the member
   * list and decremented the count, producing a visible flip-back.
   */
  const mutate = useCallback((variables) => {
    const { currentUser, isJoined } = variables || {};
    if (isJoined && currentUser?.verificationStatus !== 'VERIFIED') {
      openVerificationModal('Verify your student ID to join communities.');
      return;
    }
    if (variables?.isJoined === false && isOwner(queryClient, variables)) {
      showToast('Transfer ownership before leaving your own community', 'error');
      return;
    }
    return toggle(variables);
  }, [toggle, isOwner, queryClient]);

  return { mutate, isLoading: false };
}
