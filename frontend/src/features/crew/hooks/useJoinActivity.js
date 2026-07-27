import { useCallback } from 'react';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { activitiesApi } from '@shared/api/apiClient';

export function useJoinActivity() {
  const applyOptimistic = useCallback((queryClient, intent, variables) => {
    const { activityId, currentUser } = variables;

    queryClient.setQueryData(['activities'], (oldData) => {
      if (!Array.isArray(oldData)) return oldData;
      return oldData.map(act => {
        if (act.id !== activityId) return act;
        
        // Optimistically calculate new member count and list
        let members = act.members || [];
        if (intent && currentUser && !members.some(m => m.userId === currentUser.id)) {
          members = [...members, { userId: currentUser.id, status: 'MEMBER', user: currentUser }];
        } else if (!intent && currentUser) {
          members = members.filter(m => m.userId !== currentUser.id);
        }

        return {
          ...act,
          members,
        };
      });
    });
  }, []);

  const applyRollback = useCallback((queryClient, intent, variables) => {
    applyOptimistic(queryClient, !intent, variables);
  }, [applyOptimistic]);

  const callApi = useCallback((intent, signal, variables) => {
    const { activityId } = variables;
    return intent
      ? activitiesApi.join(activityId, { signal })
      : activitiesApi.leave(activityId, { signal });
  }, []);

  const { mutate } = useToggleMutation({
    entityKey: (vars) => `joinActivity:${vars.activityId}`,
    applyOptimistic,
    applyRollback,
    callApi,
    invalidateKeys: [['activities']],
  });

  return { mutate, isLoading: false };
}
