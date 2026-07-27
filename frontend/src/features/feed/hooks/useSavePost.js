import { useCallback } from 'react';
import { useToggleMutation } from '@shared/hooks/useToggleMutation';
import { postsApi } from '@shared/api/apiClient';

const setBookmarkState = (oldData, postId, nextSaved, postSnapshot) => {
  if (!oldData) return oldData;

  const updatePost = (p) => {
    if (p.id !== postId) return p;
    return { ...p, isBookmarked: nextSaved, hasBookmarked: nextSaved };
  };

  if (nextSaved && postSnapshot) {
    if (Array.isArray(oldData)) {
      if (oldData.some(p => p.id === postId)) return oldData;
      return [{ ...postSnapshot, isBookmarked: true, hasBookmarked: true }, ...oldData];
    }
    if (oldData.posts && Array.isArray(oldData.posts)) {
      if (oldData.posts.some(p => p.id === postId)) return oldData;
      return { ...oldData, posts: [{ ...postSnapshot, isBookmarked: true }, ...oldData.posts] };
    }
    if (oldData.pages) {
      if (oldData.pages.some(pg => pg.posts?.some(p => p.id === postId))) return oldData;
      return {
        ...oldData,
        pages: oldData.pages.map((pg, i) =>
          i === 0 && pg.posts ? { ...pg, posts: [{ ...postSnapshot, isBookmarked: true }, ...pg.posts] } : pg
        ),
      };
    }
  }

  if (!nextSaved) {
    if (Array.isArray(oldData)) return oldData.filter(p => p.id !== postId);
    if (oldData.posts && Array.isArray(oldData.posts)) return { ...oldData, posts: oldData.posts.filter(p => p.id !== postId) };
    if (oldData.pages) {
      return {
        ...oldData,
        pages: oldData.pages.map(pg =>
          pg.posts ? { ...pg, posts: pg.posts.filter(p => p.id !== postId) } : pg
        ),
      };
    }
  }

  if (Array.isArray(oldData)) return oldData.map(updatePost);
  if (oldData.posts) return { ...oldData, posts: oldData.posts.map(updatePost) };
  return oldData;
};

export function useSavePost() {
  const applyOptimistic = useCallback((queryClient, intent, variables) => {
    const { postId, postData } = variables;
    queryClient.setQueriesData({ queryKey: ['bookmarks'] }, (old) => setBookmarkState(old, postId, intent, postData));
    queryClient.setQueryData(['post', postId], (old) =>
      old ? { ...old, isBookmarked: intent, hasBookmarked: intent } : old
    );
    const flagUpdater = (old) => {
      if (!old) return old;
      const up = (p) => p.id === postId ? { ...p, isBookmarked: intent, hasBookmarked: intent } : p;
      if (Array.isArray(old)) return old.map(up);
      if (old.posts) return { ...old, posts: old.posts.map(up) };
      if (old.pages) return { ...old, pages: old.pages.map(pg => pg.posts ? { ...pg, posts: pg.posts.map(up) } : pg) };
      return old;
    };
    queryClient.setQueriesData({ queryKey: ['feed'] }, flagUpdater);
    queryClient.setQueriesData({ queryKey: ['posts'] }, flagUpdater);
  }, []);

  const applyRollback = useCallback((queryClient, intent, variables) => {
    applyOptimistic(queryClient, !intent, variables);
  }, [applyOptimistic]);

  const callApi = useCallback((intent, signal, variables) => {
    const { postId } = variables;
    return intent ? postsApi.bookmarkPost(postId, { signal }) : postsApi.unbookmarkPost(postId, { signal });
  }, []);

  const { mutate } = useToggleMutation({
    entityKey: (vars) => `savePost:${vars.postId}`,
    applyOptimistic,
    applyRollback,
    callApi,
    invalidateKeys: [['bookmarks']],
  });

  return { mutate, isLoading: false };
}
