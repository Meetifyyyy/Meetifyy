import { useCallback } from 'react';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { communitiesApi } from '@shared/api/apiClient';
import { COMMUNITY_KEYS } from '@shared/hooks/useCommunities';

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

  const { mutate } = useToggleMutation({
    entityKey: (vars) => `joinCommunity:${vars.communityId}`,
    applyOptimistic,
    applyRollback,
    callApi,
    invalidateKeys: (vars) => [['communities'], ['campusCommunities'], ['community', vars.communityId], ['conversations']],
  });

  return { mutate, isLoading: false };
}
