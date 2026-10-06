import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { toggleLike, readLike } from '@shared/utils/likeSync';
import { showToast } from '@shared/utils/toast';
import { isPostListQuery } from '../utils/postCache';

export const postLikeKey = (postId) => `post:${postId}`;

/** What a cached post says, across the field names the API has used. */
export function postLikeSnapshot(post, currentUserId) {
  const liked = post.hasLiked !== undefined ? !!post.hasLiked
    : post.isLiked !== undefined ? !!post.isLiked
      : post.isLikedByMe !== undefined ? !!post.isLikedByMe
        : (post.likedBy ? post.likedBy.includes(currentUserId) : false);
  const count = post.likeCount ?? post.likesCount ?? post.likes ?? 0;
  return { liked, count: Number(count) || 0 };
}

/** The like state to render for a post: pending/confirmed state first, else the cache. */
export function readPostLike(post, currentUserId) {
  return readLike(postLikeKey(post.id), postLikeSnapshot(post, currentUserId));
}

/**
 * Writes an ABSOLUTE like state into every cache that holds the post — the
 * feeds, profile and community lists, and the open post. Absolute, not ±1:
 * applying the same state twice is a no-op, so repeated writes cannot drift.
 * `liked` is optional (someone else's like changes only the count).
 */
export function writePostLike(queryClient, postId, { liked, count }) {
  const patch = (p) => {
    if (!p || p.id !== postId) return p;
    const sameCount = (p.likeCount ?? p.likesCount) === count;
    const sameLiked = liked === undefined || (p.hasLiked ?? p.isLiked ?? p.isLikedByMe) === liked;
    if (sameCount && sameLiked) return p;
    return {
      ...p,
      likeCount: count,
      likesCount: count,
      ...(liked === undefined ? {} : { isLiked: liked, hasLiked: liked, isLikedByMe: liked }),
    };
  };
  const updater = (old) => {
    if (!old) return old;
    if (old.id === postId) return patch(old);
    if (Array.isArray(old)) return old.map(patch);
    if (Array.isArray(old.posts)) return { ...old, posts: old.posts.map(patch) };
    if (old.pages) {
      return {
        ...old,
        pages: old.pages.map((page) => {
          if (Array.isArray(page.posts)) return { ...page, posts: page.posts.map(patch) };
          if (Array.isArray(page.items)) return { ...page, items: page.items.map(patch) };
          return page;
        }),
      };
    }
    return old;
  };
  queryClient.setQueriesData({ predicate: isPostListQuery }, updater);
  queryClient.setQueryData(['post', postId], updater);
}

/**
 * Like/unlike a post. Ordering, coalescing and stale-response protection live
 * in likeSync; this only supplies the request and the cache writer.
 */
export function useLikePost() {
  const queryClient = useQueryClient();

  const toggle = useCallback((post, currentUserId) => {
    const postId = post.id;
    return toggleLike(postLikeKey(postId), postLikeSnapshot(post, currentUserId), {
      send: (liked) => (liked ? postsApi.likePost(postId) : postsApi.unlikePost(postId)),
      write: (shown) => writePostLike(queryClient, postId, shown),
      onError: () => showToast("Couldn't update your like. Try again."),
    });
  }, [queryClient]);

  return { toggle };
}
