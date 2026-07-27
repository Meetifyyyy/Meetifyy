import { useCallback } from 'react';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { communitiesApi } from '@shared/api/apiClient';

export function useJoinCommunity() {
  const applyOptimistic = useCallback((queryClient, intent, variables) => {
    const { communityId, currentUser } = variables;
    const updater = (oldData) => {
      if (!oldData) return oldData;
      const update = (c) => {
        if (c.id !== communityId) return c;
        const current = c.memberCount || c.membersCount || 0;
        const newCount = Math.max(0, current + (intent ? 1 : -1));
        return { ...c, isMember: intent, memberCount: newCount, membersCount: newCount };
      };
      if (Array.isArray(oldData)) return oldData.map(update);
      return oldData;
    };

    queryClient.setQueryData(['communities'], updater);
    queryClient.setQueryData(['campusCommunities'], updater);

    queryClient.setQueryData(['community', communityId], (old) => {
      if (!old) return old;
      const current = old.memberCount || old.membersCount || 0;
      const newCount = Math.max(0, current + (intent ? 1 : -1));
      let members = old.members || [];
      if (intent && currentUser && !members.some(m => (m.userId || m.id) === currentUser.id)) {
        members = [...members, { userId: currentUser.id, user: currentUser }];
      } else if (!intent && currentUser) {
        members = members.filter(m => (m.userId || m.id) !== currentUser.id);
      }
      return { ...old, isMember: intent, memberCount: newCount, membersCount: newCount, members };
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
    invalidateKeys: (vars) => [['communities'], ['campusCommunities'], ['community', vars.communityId]],
  });

  return { mutate, isLoading: false };
}
