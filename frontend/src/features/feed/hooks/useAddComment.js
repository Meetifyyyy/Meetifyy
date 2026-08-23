import { useMutation, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@shared/utils/toast';
import { postsApi } from '@shared/api/apiClient';
import { isPostListQuery } from '../utils/postCache';

// Monotonic, so two comments posted inside the same millisecond cannot collide
// on `temp_<Date.now()>` and have one silently overwrite the other.
let tempCommentSeq = 0;
const nextTempId = () => `temp_${Date.now()}_${++tempCommentSeq}`;

/** +1 on the post's comment count, in whichever shape this cache holds posts. */
function bumpCommentCount(postId, delta) {
  const updatePost = (p) => {
    if (!p || p.id !== postId) return p;
    const current = p.commentsCount !== undefined ? p.commentsCount : (p.commentCount || 0);
    const next = Math.max(0, current + delta);
    return { ...p, commentCount: next, commentsCount: next };
  };

  return (oldData) => {
    if (!oldData) return oldData;
    if (Array.isArray(oldData)) return oldData.map(updatePost);
    if (Array.isArray(oldData.posts)) return { ...oldData, posts: oldData.posts.map(updatePost) };
    if (oldData.pages) {
      return {
        ...oldData,
        pages: oldData.pages.map((page) => (page.posts ? { ...page, posts: page.posts.map(updatePost) } : page)),
      };
    }
    return oldData;
  };
}

export function useAddComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, text, parentId, mentions }) =>
      postsApi.addComment(postId, { text, parentId, mentions }),

    onMutate: async ({ postId, text, parentId, currentUser }) => {
      const queryKey = ['post', postId];
      await queryClient.cancelQueries({ queryKey });

      const previousPost = queryClient.getQueryData(queryKey);
      const tempId = nextTempId();

      // Predicate rather than a key list: the list here was missing
      // 'community-posts' and 'bookmarks', so a comment left from inside a
      // community never moved the count on the card behind the modal.
      queryClient.setQueriesData({ predicate: isPostListQuery }, bumpCommentCount(postId, 1));

      if (previousPost) {
        const optimisticComment = {
          id: tempId,
          postId,
          text,
          parentId: parentId || null,
          authorId: currentUser?.id,
          createdAt: new Date().toISOString(),
          isDeleted: false,
          likeCount: 0,
          likesCount: 0,
          hasLiked: false,
          isLiked: false,
          isLikedByMe: false,
          author: {
            id: currentUser?.id,
            username: currentUser?.username,
            displayName: currentUser?.displayName,
            avatar: currentUser?.avatar,
          },
        };

        queryClient.setQueryData(queryKey, (old) => {
          if (!old) return old;
          const count = old.commentsCount !== undefined ? old.commentsCount : (old.commentCount || 0);
          return {
            ...old,
            commentCount: count + 1,
            commentsCount: count + 1,
            comments: [...(old.comments || []), optimisticComment],
          };
        });
      }

      // A plain object, not a rollback closure. `onSuccess` needs the temp id to
      // swap the placeholder for the real row, and a closure gave it nothing to
      // work with.
      return { previousPost, queryKey, tempId, postId };
    },

    onError: (_err, _variables, context) => {
      if (context?.previousPost) {
        queryClient.setQueryData(context.queryKey, context.previousPost);
      }
      queryClient.setQueriesData({ predicate: isPostListQuery }, bumpCommentCount(context?.postId, -1));
      showToast("Couldn't post comment", 'error');
    },

    onSuccess: (created, _variables, context) => {
      // Swap the placeholder for the server's row in place, rather than relying
      // on the invalidation below to do it. An invalidation-triggered refetch can
      // be cancelled by the next add or delete (both call `cancelQueries`), and
      // when it was, the temp comment was never reconciled — the real one arrived
      // alongside it and the same comment rendered twice.
      if (created?.id && context?.tempId) {
        queryClient.setQueryData(context.queryKey, (old) => {
          if (!old?.comments) return old;
          const withoutTemp = old.comments.filter((c) => c.id !== context.tempId && c.id !== created.id);
          return {
            ...old,
            comments: [...withoutTemp, {
              ...created,
              isDeleted: false,
              likesCount: created.likeCount ?? 0,
              hasLiked: false,
              isLiked: false,
              isLikedByMe: false,
            }],
          };
        });
      }

      // Reconcile against the server afterwards. The count was already moved by
      // exactly one, matching the backend's unconditional increment, so ['feed']
      // is deliberately left alone — invalidating it would refetch every loaded
      // feed page on every comment for a number that is already right.
      queryClient.invalidateQueries({ queryKey: context?.queryKey ?? ['post'] });
    },
  });
}
