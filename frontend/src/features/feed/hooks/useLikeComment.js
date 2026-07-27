import { useCallback } from 'react';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { postsApi } from '@shared/api/apiClient';

export function useLikeComment() {
  const updateComment = useCallback((queryClient, intent, variables) => {
    const { commentId, postId } = variables;
    const queryKey = ['post', postId];
    queryClient.setQueryData(queryKey, (old) => {
      if (!old || !Array.isArray(old.comments)) return old;
      return {
        ...old,
        comments: old.comments.map(c => {
          if (c.id !== commentId) return c;
          const prevLiked = c.isLikedByMe !== undefined ? c.isLikedByMe : (c.isLiked || c.hasLiked || false);
          if (prevLiked === intent) return c;
          const currentLikes = c.likeCount || c.likesCount || 0;
          const newLikeCount = Math.max(0, currentLikes + (intent ? 1 : -1));
          return { ...c, isLiked: intent, hasLiked: intent, isLikedByMe: intent, likeCount: newLikeCount, likesCount: newLikeCount };
        }),
      };
    });
  }, []);

  const applyRollback = useCallback((queryClient, intent, variables) => {
    updateComment(queryClient, !intent, variables);
  }, [updateComment]);

  const callApi = useCallback((intent, signal, variables) => {
    const { commentId } = variables;
    return intent
      ? postsApi.likeComment(commentId, { signal })
      : postsApi.unlikeComment(commentId, { signal });
  }, []);

  const { mutate } = useToggleMutation({
    entityKey: (vars) => `likeComment:${vars.commentId}`,
    applyOptimistic: updateComment,
    applyRollback,
    callApi,
    invalidateKeys: (vars) => [['post', vars.postId]],
  });

  return { mutate, isLoading: false };
}
