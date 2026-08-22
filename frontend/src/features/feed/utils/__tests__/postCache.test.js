import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { addCreatedPostToCaches, prependPost, POST_LIST_KEYS } from '../postCache';

const post = (id, extra = {}) => ({ id, text: `post ${id}`, ...extra });

let qc;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('prependPost', () => {
  it('leaves an absent cache absent rather than inventing a list', () => {
    expect(prependPost(undefined, post('p1'))).toBeUndefined();
  });

  it('prepends into the first page of an infinite query', () => {
    const old = { pages: [{ posts: [post('p1')] }, { posts: [post('p0')] }], pageParams: [undefined, 'c'] };
    const next = prependPost(old, post('p2'));
    expect(next.pages[0].posts.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(next.pages[1].posts.map((p) => p.id)).toEqual(['p0']);
  });

  it('dedupes, so a socket echo or refetch cannot render it twice', () => {
    const old = { pages: [{ posts: [post('p1')] }], pageParams: [undefined] };
    const next = prependPost(prependPost(old, post('p2')), post('p2'));
    expect(next.pages[0].posts.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('handles a flat array cache', () => {
    expect(prependPost([post('p1')], post('p2')).map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('handles a page keyed `items` instead of `posts`', () => {
    const old = { pages: [{ items: [post('p1')] }], pageParams: [undefined] };
    expect(prependPost(old, post('p2')).pages[0].items.map((p) => p.id)).toEqual(['p2', 'p1']);
  });
});

describe('addCreatedPostToCaches', () => {
  beforeEach(() => {
    // Every surface that renders a post list, as it would be after a first load.
    qc.setQueryData(['feed', '', 'me'], { pages: [{ posts: [post('old')] }], pageParams: [undefined] });
    qc.setQueryData(['user-posts', 'me'], { pages: [{ posts: [post('old')] }], pageParams: [undefined] });
    qc.setQueryData(['community-posts', 'c1'], [post('old')]);
    qc.setQueryData(['bookmarks'], { pages: [{ posts: [] }], pageParams: [undefined] });
    qc.setQueryData(['unrelated'], { pages: [{ posts: [post('old')] }], pageParams: [undefined] });
  });

  it('reaches every post-list surface, not just the home feed', () => {
    // The bug: creation prepended to ['feed'] only, so a new post was missing
    // from the author's own profile and from the community it was posted into.
    addCreatedPostToCaches(qc, post('new'));

    expect(qc.getQueryData(['feed', '', 'me']).pages[0].posts[0].id).toBe('new');
    expect(qc.getQueryData(['user-posts', 'me']).pages[0].posts[0].id).toBe('new');
    expect(qc.getQueryData(['community-posts', 'c1'])[0].id).toBe('new');
  });

  it('does not touch caches outside the known post-list keys', () => {
    addCreatedPostToCaches(qc, post('new'));
    expect(qc.getQueryData(['unrelated']).pages[0].posts.map((p) => p.id)).toEqual(['old']);
  });

  it('seeds the post detail cache so opening it does not spin', () => {
    addCreatedPostToCaches(qc, post('new'));
    expect(qc.getQueryData(['post', 'new']).id).toBe('new');
  });

  it('fills in the counters and viewer flags the create response omits', () => {
    const result = addCreatedPostToCaches(qc, post('new'));
    expect(result).toMatchObject({
      likeCount: 0, likesCount: 0,
      commentCount: 0, commentsCount: 0,
      hasLiked: false, isLiked: false, isLikedByMe: false,
      hasBookmarked: false, isBookmarked: false,
    });
  });

  it('preserves counts the server did send', () => {
    const result = addCreatedPostToCaches(qc, post('new', { likeCount: 3, commentCount: 2 }));
    expect(result.likesCount).toBe(3);
    expect(result.commentsCount).toBe(2);
  });

  it('covers the same key set the other post mutations use', () => {
    expect(POST_LIST_KEYS).toEqual(['feed', 'posts', 'user-posts', 'bookmarks', 'community-posts']);
  });
});
