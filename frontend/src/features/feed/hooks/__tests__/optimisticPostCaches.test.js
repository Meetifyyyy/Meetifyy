import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { isPostListQuery, POST_LIST_KEYS } from '../../utils/postCache';

/**
 * These hooks each apply their optimistic update across "every cache that can
 * hold a post". They used to each carry their own hand-written key list, and
 * those lists drifted: liking, saving and commenting all omitted
 * `community-posts`, so inside a community none of the three showed any
 * optimistic change at all — the UI only moved once the request came back and
 * the list refetched. That is what made community posts feel slow.
 *
 * The fix was to route all of them through the one shared predicate, so these
 * tests pin the predicate's coverage and the behaviour that depends on it.
 */

const post = (over = {}) => ({
  id: 'p1', likeCount: 3, likesCount: 3, commentCount: 1, commentsCount: 1,
  isLikedByMe: false, isLiked: false, hasLiked: false,
  isBookmarked: false, hasBookmarked: false, ...over,
});

const q = (key) => ({ queryKey: key });

describe('isPostListQuery', () => {
  it('covers every cache a post can appear in', () => {
    for (const key of ['feed', 'posts', 'user-posts', 'bookmarks', 'community-posts']) {
      expect(isPostListQuery(q([key]))).toBe(true);
    }
  });

  it('matches a community list including its id segment', () => {
    expect(isPostListQuery(q(['community-posts', 'c1']))).toBe(true);
  });

  it('does not match unrelated caches', () => {
    expect(isPostListQuery(q(['communities']))).toBe(false);
    expect(isPostListQuery(q(['conversations']))).toBe(false);
    expect(isPostListQuery(q(['post', 'p1']))).toBe(false);
  });

  it('lists community-posts — the omission that caused the bug', () => {
    expect(POST_LIST_KEYS).toContain('community-posts');
  });
});

describe('setQueriesData over the predicate', () => {
  const seed = () => {
    const qc = new QueryClient();
    qc.setQueryData(['feed'], { posts: [post()] });
    qc.setQueryData(['community-posts', 'c1'], { pages: [{ posts: [post()] }] });
    qc.setQueryData(['user-posts', 'alice'], [post()]);
    return qc;
  };

  const read = (qc, key) => {
    const data = qc.getQueryData(key);
    if (Array.isArray(data)) return data[0];
    if (data?.posts) return data.posts[0];
    return data.pages[0].posts[0];
  };

  it('reaches the community list, not just the main feed', () => {
    const qc = seed();
    qc.setQueriesData({ predicate: isPostListQuery }, (old) => {
      const up = (p) => ({ ...p, isLikedByMe: true, likeCount: p.likeCount + 1 });
      if (Array.isArray(old)) return old.map(up);
      if (old?.posts) return { ...old, posts: old.posts.map(up) };
      if (old?.pages) {
        return { ...old, pages: old.pages.map((pg) => ({ ...pg, posts: pg.posts.map(up) })) };
      }
      return old;
    });

    // The regression: this one used to be left untouched.
    expect(read(qc, ['community-posts', 'c1'])).toMatchObject({
      isLikedByMe: true, likeCount: 4,
    });
    expect(read(qc, ['feed'])).toMatchObject({ isLikedByMe: true, likeCount: 4 });
    expect(read(qc, ['user-posts', 'alice'])).toMatchObject({ isLikedByMe: true, likeCount: 4 });
  });
});
