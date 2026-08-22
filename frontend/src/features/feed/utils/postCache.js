/**
 * Shared post-list cache helpers.
 *
 * Deleting, liking and poll-voting already agreed on one set of query-key
 * prefixes that can hold a list of posts, and each applied its change to all of
 * them. Creating a post did not: it prepended to `['feed']` only, so a new post
 * was missing from the author's profile and from the community it was posted
 * into until those queries happened to refetch. Same list, same rules, one
 * place — so the next writer can't drift again.
 */

// Every query-key prefix that can ever hold a list of post objects.
export const POST_LIST_KEYS = ['feed', 'posts', 'user-posts', 'bookmarks', 'community-posts'];

export const isPostListQuery = (query) => POST_LIST_KEYS.includes(query.queryKey[0]);

/**
 * Prepend a post to a cached list, deduped by id so a later refetch or socket
 * event can never render it twice. Handles the infinite-query shape
 * ({ pages: [{ posts | items }] }) plus flat array and { posts } shapes.
 */
export function prependPost(old, post) {
  if (!post?.id) return old;
  // Never conjure a list that was not there: an absent cache means nothing is
  // rendering it, and seeding one page would misrepresent it as fully loaded.
  if (!old) return old;

  if (old.pages) {
    const pages = old.pages.map((pg) => {
      if (Array.isArray(pg?.posts)) return { ...pg, posts: pg.posts.filter((p) => p?.id !== post.id) };
      if (Array.isArray(pg?.items)) return { ...pg, items: pg.items.filter((p) => p?.id !== post.id) };
      return pg;
    });
    const first = pages[0] || {};
    const key = Array.isArray(first.items) && !Array.isArray(first.posts) ? 'items' : 'posts';
    pages[0] = { ...first, [key]: [post, ...(first[key] || [])] };
    return { ...old, pages };
  }
  if (Array.isArray(old.posts)) return { ...old, posts: [post, ...old.posts.filter((p) => p?.id !== post.id)] };
  if (Array.isArray(old)) return [post, ...old.filter((p) => p?.id !== post.id)];
  return old;
}

/**
 * Fill in the derived counters and viewer flags that `formatPost` adds on read
 * paths but `createPost` does not, so a just-created post renders identically
 * to the same post after a refetch.
 */
export function normalizeCreatedPost(post) {
  if (!post?.id) return post;
  const likeCount = post.likeCount ?? 0;
  const commentCount = post.commentCount ?? 0;
  return {
    ...post,
    likeCount,
    likesCount: likeCount,
    commentCount,
    commentsCount: commentCount,
    hasLiked: false,
    isLiked: false,
    isLikedByMe: false,
    hasBookmarked: false,
    isBookmarked: false,
  };
}

/**
 * Put a freshly created post into every list that should already be showing it,
 * for the author, right now.
 */
export function addCreatedPostToCaches(queryClient, created) {
  const post = normalizeCreatedPost(created);
  if (!post?.id) return post;
  queryClient.setQueriesData({ predicate: isPostListQuery }, (old) => prependPost(old, post));
  queryClient.setQueryData(['post', post.id], post);
  return post;
}
