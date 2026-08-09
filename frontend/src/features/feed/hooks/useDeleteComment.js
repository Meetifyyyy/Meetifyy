import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';

/**
 * Recursively walks the flat comment array and returns a new array where
 * the comment matching `commentId` is replaced with a soft-deleted placeholder.
 */
function applyOptimisticDelete(comments, commentId) {
  return comments.map((c) => {
    if (c.id === commentId) {
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
    }
    return c;
  });
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
      showToast('Could not delete comment. Please try again.');
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
