import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { isPostListQuery } from '../utils/postCache';

/** Field the card reads to render its "Deleting post…" state. */
export const DELETING_FLAG = '__deleting';

/** Apply `fn` to the matching post wherever a cached list shape holds it. */
function mapPost(old, postId, fn) {
  if (!old) return old;
  const applyTo = (list) => {
    if (!Array.isArray(list)) return list;
    let changed = false;
    const next = list.map((p) => {
      if (p?.id !== postId) return p;
      changed = true;
      return fn(p);
    });
    // Returning the original array when nothing matched keeps React Query's
    // structural sharing intact, so untouched lists do not re-render.
    return changed ? next.filter(Boolean) : list;
  };

  if (Array.isArray(old)) return applyTo(old);
  if (Array.isArray(old.posts)) {
    const posts = applyTo(old.posts);
    return posts === old.posts ? old : { ...old, posts };
  }
  if (old.pages) {
    let changed = false;
    const pages = old.pages.map((page) => {
      if (Array.isArray(page?.posts)) {
        const posts = applyTo(page.posts);
        if (posts === page.posts) return page;
        changed = true;
        return { ...page, posts };
      }
      if (Array.isArray(page?.items)) {
        const items = applyTo(page.items);
        if (items === page.items) return page;
        changed = true;
        return { ...page, items };
      }
      return page;
    });
    return changed ? { ...old, pages } : old;
  }
  return old;
}

const markDeleting = (post) => ({ ...post, [DELETING_FLAG]: true });
const clearDeleting = (post) => {
  const { [DELETING_FLAG]: _flag, ...rest } = post;
  return rest;
};
/** `mapPost` drops nulls, so returning null removes the post outright. */
const dropPost = () => null;

/**
 * Deletes a post.
 *
 * The card responds on the very next paint — but it is MARKED, not removed.
 * Removing it outright (what this did before) is instant and reads as
 * finished, which is a promise the client cannot keep: the request may still
 * fail, and the post then reappears in a list the user has already scrolled
 * past. Marking gives the same immediate response while the outcome is still
 * honest — the card shows "Deleting post…" with a spinner, its own delete
 * control is disabled so a second request cannot be issued, and it is removed
 * only once the server has actually said so.
 *
 * The removal itself never refetches. Every cached list that can hold the post
 * (feed, profile, saved, bookmarks, community) is edited in place and the
 * detail entry is dropped, so nothing is re-fetched to learn about a post that
 * no longer exists.
 *
 * A failure restores the exact snapshotted cache state, so a post that could
 * not be deleted comes back as it was rather than as whatever a refetch would
 * have produced.
 */
export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId }) => postsApi.deletePost(postId),

    onMutate: async ({ postId }) => {
      // Cancel in-flight refetches so a response issued before the mark lands
      // after it and silently un-marks the card.
      await queryClient.cancelQueries({ predicate: isPostListQuery });
      await queryClient.cancelQueries({ queryKey: ['post', postId] });

      const snapshot = queryClient.getQueriesData({ predicate: isPostListQuery });
      const previousPost = queryClient.getQueryData(['post', postId]);

      queryClient.setQueriesData({ predicate: isPostListQuery }, (old) =>
        mapPost(old, postId, markDeleting),
      );

      return { snapshot, previousPost, postId };
    },

    onSuccess: (_data, { postId }) => {
      // Now it is genuinely gone. Removed from every list in place — no
      // invalidation, so no list refetches to discover an absence the client
      // already knows about.
      queryClient.setQueriesData({ predicate: isPostListQuery }, (old) =>
        mapPost(old, postId, dropPost),
      );
      // The detail entry is removed rather than invalidated: invalidating it
      // would schedule a fetch for a post the server will now 404.
      queryClient.removeQueries({ queryKey: ['post', postId] });
    },

    onError: (err, { postId }, context) => {
      context?.snapshot?.forEach(([queryKey, data]) => {
        if (data !== undefined) queryClient.setQueryData(queryKey, data);
      });
      if (context?.previousPost) {
        queryClient.setQueryData(['post', postId], context.previousPost);
      }

      // The restore above puts the post back with its flag cleared, but only
      // for lists that were in the snapshot. Anything that appeared since —
      // a list mounted while the request was in flight — is cleared here, so
      // no card can be stranded showing "Deleting post…" forever.
      queryClient.setQueriesData({ predicate: isPostListQuery }, (old) =>
        mapPost(old, postId, clearDeleting),
      );

      // A post already gone on the server is not a failure to report: the
      // user asked for it to be deleted and it is. Reconcile quietly.
      if (err?.status === 404) {
        queryClient.setQueriesData({ predicate: isPostListQuery }, (old) =>
          mapPost(old, postId, dropPost),
        );
        queryClient.removeQueries({ queryKey: ['post', postId] });
        return;
      }

      // Everything else — 403, a 5xx, a 12s timeout, a dead connection —
      // carries a message worth showing. `apiClient` turns an aborted request
      // into "Request timed out…" and a connection failure into a TypeError,
      // so the fallback covers the case where neither produced wording.
      showToast(err?.message || "Couldn't delete post", 'error');
    },
  });
}
