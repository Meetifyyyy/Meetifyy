import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { communitiesApi } from '@shared/api/apiClient';
import { COMMUNITY_KEYS } from '@shared/hooks/useCommunities';
import { isCommunityOwner } from '@shared/utils/community';
import { showToast } from '@shared/utils/toast';

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

    // Use the shared key definitions rather than re-typing them: the campus list
    // was previously written to ['campusCommunities'], which is not a key any
    // query uses (COMMUNITY_KEYS.campus is ['communities','campus']), so joining
    // a campus community never updated that list optimistically.
    queryClient.setQueryData(COMMUNITY_KEYS.all, updater);
    queryClient.setQueryData(COMMUNITY_KEYS.campus, updater);

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

  const { mutate: toggle } = useToggleMutation({
    entityKey: (vars) => `joinCommunity:${vars.communityId}`,
    applyOptimistic,
    applyRollback,
    callApi,
    // `['communities']` covers the campus list too — its key is
    // ['communities','campus']. The old list also named ['campusCommunities'],
    // which no query has ever used.
    invalidateKeys: (vars) => [['communities'], ['community', vars.communityId], ['conversations']],
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
    if (variables?.isJoined === false && isOwner(queryClient, variables)) {
      showToast('Transfer ownership before leaving your own community', 'error');
      return;
    }
    return toggle(variables);
  }, [toggle, isOwner, queryClient]);

  return { mutate, isLoading: false };
}
