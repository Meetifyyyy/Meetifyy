import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { toggleLike, readLike } from '@shared/utils/likeSync';
import { showToast } from '@shared/utils/toast';

export const commentLikeKey = (commentId) => `comment:${commentId}`;

export function commentLikeSnapshot(comment, currentUserId) {
  const liked = comment.hasLiked !== undefined ? !!comment.hasLiked
    : comment.isLiked !== undefined ? !!comment.isLiked
      : comment.isLikedByMe !== undefined ? !!comment.isLikedByMe
        : (comment.likedBy ? comment.likedBy.includes(currentUserId) : false);
  const count = comment.likeCount ?? comment.likesCount ?? comment.likes ?? 0;
  return { liked, count: Number(count) || 0 };
}

export function readCommentLike(comment, currentUserId) {
  return readLike(commentLikeKey(comment.id), commentLikeSnapshot(comment, currentUserId));
}

/**
 * Absolute write into the post's comment list — the one cache every comment
 * page is merged into (see loadMoreComments in PostView).
 */
export function writeCommentLike(queryClient, postId, commentId, { liked, count }) {
  queryClient.setQueryData(['post', postId], (old) => {
    if (!old || !Array.isArray(old.comments)) return old;
    let changed = false;
    const comments = old.comments.map((c) => {
      if (c.id !== commentId) return c;
      const sameCount = (c.likeCount ?? c.likesCount) === count;
      const sameLiked = liked === undefined || (c.hasLiked ?? c.isLiked ?? c.isLikedByMe) === liked;
      if (sameCount && sameLiked) return c;
      changed = true;
      return {
        ...c,
        likeCount: count,
        likesCount: count,
        ...(liked === undefined ? {} : { isLiked: liked, hasLiked: liked, isLikedByMe: liked }),
      };
    });
    return changed ? { ...old, comments } : old;
  });
}

export function useLikeComment() {
  const queryClient = useQueryClient();

  const toggle = useCallback((postId, comment, currentUserId) => {
    const commentId = comment.id;
    return toggleLike(commentLikeKey(commentId), commentLikeSnapshot(comment, currentUserId), {
      send: (liked) => (liked ? postsApi.likeComment(commentId) : postsApi.unlikeComment(commentId)),
      write: (shown) => writeCommentLike(queryClient, postId, commentId, shown),
      onError: () => showToast("Couldn't update your like. Try again."),
    });
  }, [queryClient]);

  return { toggle };
}
