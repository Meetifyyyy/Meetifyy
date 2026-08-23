import { useCallback } from 'react';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { postsApi } from '@shared/api/apiClient';
import { isPostListQuery } from '../utils/postCache';

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
  // One predicate over every cache that can hold posts, rather than a
  // hand-written key list. The old list omitted 'community-posts', so a like
  // inside a community produced no optimistic update at all — the heart only
  // moved once the request came back and the list refetched, which is exactly
  // the "communities feel slow" complaint. Deleting and poll-voting already
  // used this predicate; liking, saving and commenting had drifted.
  const applyIntent = useCallback((queryClient, postId, liked) => {
    const updater = (old) => updatePostInCache(old, postId, liked);
    queryClient.setQueriesData({ predicate: isPostListQuery }, updater);
    queryClient.setQueryData(['post', postId], updater);
  }, []);

  const applyOptimistic = useCallback((queryClient, intent, variables) => {
    applyIntent(queryClient, variables.postId, intent);
  }, [applyIntent]);

  const applyRollback = useCallback((queryClient, intent, variables) => {
    applyIntent(queryClient, variables.postId, !intent);
  }, [applyIntent]);

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
