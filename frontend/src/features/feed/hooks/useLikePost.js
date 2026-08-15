import { useCallback } from 'react';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { postsApi } from '@shared/api/apiClient';

// Helper to update a post in any query structure
const updatePostInCache = (oldData, postId, nextLiked) => {
  if (!oldData) return oldData;

  const updatePost = (p) => {
    if (p.id !== postId) return p;
    const currentLikes = p.likesCount !== undefined ? p.likesCount : (p.likeCount || 0);
    const prevLiked = p.isLikedByMe !== undefined ? p.isLikedByMe : (p.isLiked || p.hasLiked || false);
    if (prevLiked === nextLiked) return p;
    const newLikeCount = Math.max(0, currentLikes + (nextLiked ? 1 : -1));
    return {
      ...p,
      isLiked: nextLiked,
      hasLiked: nextLiked,
      isLikedByMe: nextLiked,
      likeCount: newLikeCount,
      likesCount: newLikeCount,
    };
  };

  if (oldData.id === postId) return updatePost(oldData);
  if (Array.isArray(oldData)) return oldData.map(updatePost);
  if (oldData.posts && Array.isArray(oldData.posts)) return { ...oldData, posts: oldData.posts.map(updatePost) };
  if (oldData.pages) {
    return {
      ...oldData,
      pages: oldData.pages.map(page => {
        if (page.posts) return { ...page, posts: page.posts.map(updatePost) };
        if (page.items) return { ...page, items: page.items.map(updatePost) };
        return page;
      })
    };
  }
  return oldData;
};

export function useLikePost() {
  const applyOptimistic = useCallback((queryClient, intent, variables) => {
    const { postId } = variables;
    const updater = (old) => updatePostInCache(old, postId, intent);

    queryClient.setQueriesData({ queryKey: ['feed'] }, updater);
    queryClient.setQueriesData({ queryKey: ['posts'] }, updater);
    queryClient.setQueriesData({ queryKey: ['user-posts'] }, updater);
    queryClient.setQueriesData({ queryKey: ['bookmarks'] }, updater);
    queryClient.setQueryData(['post', postId], updater);
  }, []);

  const applyRollback = useCallback((queryClient, intent, variables) => {
    const { postId } = variables;
    const updater = (old) => updatePostInCache(old, postId, !intent);

    queryClient.setQueriesData({ queryKey: ['feed'] }, updater);
    queryClient.setQueriesData({ queryKey: ['posts'] }, updater);
    queryClient.setQueriesData({ queryKey: ['user-posts'] }, updater);
    queryClient.setQueriesData({ queryKey: ['bookmarks'] }, updater);
    queryClient.setQueryData(['post', postId], updater);
  }, []);

  const callApi = useCallback((intent, signal, variables) => {
    const { postId } = variables;
    return intent ? postsApi.likePost(postId, { signal }) : postsApi.unlikePost(postId, { signal });
  }, []);

  const { mutate } = useToggleMutation({
    entityKey: (vars) => `likePost:${vars.postId}`,
    applyOptimistic,
    applyRollback,
    callApi,
    invalidateKeys: (vars) => [['post', vars.postId]],
  });

  return { mutate, isLoading: false };
}
