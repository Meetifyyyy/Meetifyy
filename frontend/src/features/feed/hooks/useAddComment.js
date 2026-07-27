import { useMutation, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@shared/utils/toast';
import { postsApi } from '@shared/api/apiClient';

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, text, parentId, mentions }) => {
      return postsApi.addComment(postId, { text, parentId, mentions });
    },
    onMutate: async ({ postId, text, parentId, currentUser }) => {
      // currentUser should be passed from the component to construct the optimistic comment
      
      const queryKey = ['post', postId];
      await queryClient.cancelQueries({ queryKey });
      
      // Update comment counts on feed/posts globally
      const updatePostCommentCount = (p) => {
        if (p.id !== postId) return p;
        const currentCount = p.commentsCount !== undefined ? p.commentsCount : (p.commentCount || 0);
        return {
          ...p,
          commentCount: currentCount + 1,
          commentsCount: currentCount + 1,
        };
      };

      const feedUpdater = (oldData) => {
        if (!oldData) return oldData;
        if (oldData.posts && Array.isArray(oldData.posts)) return { ...oldData, posts: oldData.posts.map(updatePostCommentCount) };
        if (oldData.pages) return { ...oldData, pages: oldData.pages.map(page => page.posts ? { ...page, posts: page.posts.map(updatePostCommentCount) } : page) };
        if (Array.isArray(oldData)) return oldData.map(updatePostCommentCount);
        return oldData;
      };

      queryClient.setQueriesData({ queryKey: ['feed'] }, feedUpdater);
      queryClient.setQueriesData({ queryKey: ['posts'] }, feedUpdater);
      queryClient.setQueriesData({ queryKey: ['user-posts'] }, feedUpdater);

      // Add actual comment to the post detail
      const previousPost = queryClient.getQueryData(queryKey);
      if (previousPost) {
        const optimisticComment = {
          id: `temp_${Date.now()}`,
          postId,
          text,
          parentId: parentId || null,
          authorId: currentUser?.id,
          createdAt: new Date().toISOString(),
          likeCount: 0,
          likesCount: 0,
          isLiked: false,
          isLikedByMe: false,
          author: {
            id: currentUser?.id,
            username: currentUser?.username,
            displayName: currentUser?.displayName,
            avatar: currentUser?.avatar
          }
        };

        queryClient.setQueryData(queryKey, {
          ...updatePostCommentCount(previousPost),
          comments: [...(previousPost.comments || []), optimisticComment]
        });
      }

      return () => {
        // Simple invalidation strategy on rollback since rolling back multiple lists perfectly is complex
        queryClient.invalidateQueries({ queryKey: ['feed'] });
        queryClient.invalidateQueries({ queryKey: ['posts'] });
        queryClient.invalidateQueries({ queryKey: ['user-posts'] });
        if (previousPost) {
          queryClient.setQueryData(queryKey, previousPost);
        }
      };
    },
    onError: (err, variables, rollback) => {
      if (typeof rollback === 'function') rollback();
      showToast('Something went wrong. Please try again.');
    },
    onSuccess: (result, variables) => {
      // The server returns the actual comment with DB ID.
      // Easiest is to invalidate the post so it fetches the real comments
      queryClient.invalidateQueries({ queryKey: ['post', variables.postId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    }
  });
}


