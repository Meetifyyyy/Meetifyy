import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';

/**
 * Applies a delete to the flat comment array the way the server will.
 *
 * A deleted comment is kept as a scrubbed placeholder only while a live reply
 * still hangs off it — dropping it would orphan those replies. A deleted leaf is
 * removed outright, and removing it can turn its own deleted parent into a leaf,
 * so the prune repeats to a fixed point.
 *
 * This used to always leave a placeholder, which disagreed with the count (also
 * decremented below) and left threads accumulating "[deleted]" rows. Matching
 * the server exactly is what stops the tree flickering when the refetch lands.
 */
export function applyOptimisticDelete(comments, commentId) {
  const scrubbed = comments.map((c) => {
    if (c.id !== commentId) return c;
    return {
      // Preserve only structural fields
      id: c.id,
      postId: c.postId,
      parentId: c.parentId,
      createdAt: c.createdAt,
      isDeleted: true,
      deletedByUser: true,
      // Scrub everything private
      text: null,
      author: null,
      authorId: null,
      likeCount: 0,
      hasLiked: false,
      isLiked: false,
      isLikedByMe: false,
    };
  });

  let survivors = scrubbed;
  for (;;) {
    const parentsWithChildren = new Set(survivors.map((c) => c.parentId).filter(Boolean));
    const next = survivors.filter((c) => !c.isDeleted || parentsWithChildren.has(c.id));
    if (next.length === survivors.length) return next;
    survivors = next;
  }
}

export function useDeleteComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId }) => postsApi.deleteComment(commentId),

    onMutate: async ({ commentId, postId }) => {
      const queryKey = ['post', postId];

      // Cancel any in-flight refetches so they don't clobber the optimistic state
      await queryClient.cancelQueries({ queryKey });

      // Snapshot for rollback
      const previousPost = queryClient.getQueryData(queryKey);

      if (previousPost) {
        queryClient.setQueryData(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            comments: applyOptimisticDelete(old.comments || [], commentId),
          };
        });
      }

      // Also optimistically decrement comment count on feed / user-posts caches
      const updatePostCommentCount = (p) => {
        if (!p || p.id !== postId) return p;
        const current = p.commentsCount !== undefined ? p.commentsCount : (p.commentCount || 0);
        const next = Math.max(0, current - 1);
        return { ...p, commentCount: next, commentsCount: next };
      };

      const feedUpdater = (oldData) => {
        if (!oldData) return oldData;
        if (oldData.posts && Array.isArray(oldData.posts))
          return { ...oldData, posts: oldData.posts.map(updatePostCommentCount) };
        if (oldData.pages)
          return {
            ...oldData,
            pages: oldData.pages.map((page) =>
              page.posts ? { ...page, posts: page.posts.map(updatePostCommentCount) } : page
            ),
          };
        if (Array.isArray(oldData)) return oldData.map(updatePostCommentCount);
        return oldData;
      };

      queryClient.setQueriesData({ queryKey: ['feed'] }, feedUpdater);
      queryClient.setQueriesData({ queryKey: ['posts'] }, feedUpdater);
      queryClient.setQueriesData({ queryKey: ['user-posts'] }, feedUpdater);

      // Return snapshot so onError can roll back
      return { previousPost, queryKey };
    },

    onError: (_err, _variables, context) => {
      // Roll back the optimistic update
      if (context?.previousPost) {
        queryClient.setQueryData(context.queryKey, context.previousPost);
      }
      // Restore feed counts too
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['user-posts'] });
      showToast("Couldn't delete comment", 'error');
    },

    onSuccess: (_result, { postId }) => {
      // Reconcile only the open post's comment tree with authoritative server
      // state (swaps our placeholder for whatever the server actually stored).
      // The feed comment COUNT was already decremented optimistically above, so
      // we deliberately do NOT invalidate ['feed']/['posts'] here — that would
      // refetch every loaded feed page after a single comment deletion for a
      // count that's already correct in the common case.
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
    },
  });
}
