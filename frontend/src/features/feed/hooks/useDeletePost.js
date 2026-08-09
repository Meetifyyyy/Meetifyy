import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';

// Every query-key prefix that can ever hold a list of post objects.
const POST_LIST_KEYS = ['feed', 'posts', 'user-posts', 'bookmarks', 'community-posts'];
const isPostListQuery = (query) => POST_LIST_KEYS.includes(query.queryKey[0]);

function removePost(old, postId) {
  if (!old) return old;
  if (Array.isArray(old)) return old.filter((p) => p?.id !== postId);
  if (Array.isArray(old.posts)) return { ...old, posts: old.posts.filter((p) => p?.id !== postId) };
  if (old.pages) {
    return {
      ...old,
      pages: old.pages.map((page) => {
        if (Array.isArray(page.posts)) return { ...page, posts: page.posts.filter((p) => p?.id !== postId) };
        if (Array.isArray(page.items)) return { ...page, items: page.items.filter((p) => p?.id !== postId) };
        return page;
      }),
    };
  }
  return old;
}

/**
 * Deletes a post with an instant optimistic removal from every cached list
 * (feed, profile, saved, bookmarks, community) plus its own detail cache —
 * no full feed refetch either way. Backend stays authoritative: a failed
 * delete restores the exact snapshotted cache state.
 */
export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId }) => postsApi.deletePost(postId),

    onMutate: async ({ postId }) => {
      // Cancel in-flight refetches so they can't clobber the optimistic removal
      // or resurrect the post via a stale response landing after us.
      await queryClient.cancelQueries({ predicate: isPostListQuery });
      await queryClient.cancelQueries({ queryKey: ['post', postId] });

      const snapshot = queryClient.getQueriesData({ predicate: isPostListQuery });
      const previousPost = queryClient.getQueryData(['post', postId]);

      queryClient.setQueriesData({ predicate: isPostListQuery }, (old) => removePost(old, postId));
      queryClient.removeQueries({ queryKey: ['post', postId] });

      return { snapshot, previousPost, postId };
    },

    onError: (_err, { postId }, context) => {
      context?.snapshot?.forEach(([queryKey, data]) => {
        if (data !== undefined) queryClient.setQueryData(queryKey, data);
      });
      if (context?.previousPost) queryClient.setQueryData(['post', postId], context.previousPost);
      showToast('Failed to delete post. Please try again.');
    },

    // No onSuccess reconciliation needed — the post is already gone from every
    // cache; there's nothing left to fetch for it. Other feed entries reconcile
    // on their own natural refetch (no forced full-feed invalidation).
  });
}
