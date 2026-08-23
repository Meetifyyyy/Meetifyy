import { describe, it, expect } from 'vitest';
import { applyOptimisticDelete } from '../useDeleteComment';

// Flat rows, the shape the ['post', id] cache holds before the tree is built.
const c = (id, parentId = null, extra = {}) => ({
  id, parentId, postId: 'p1', text: `c ${id}`, author: { id: 'u1' }, isDeleted: false, ...extra,
});

const ids = (list) => list.map((x) => x.id);

describe('applyOptimisticDelete', () => {
  it('removes a deleted leaf outright rather than leaving a tombstone', () => {
    // Leaving one meant threads filled with "[deleted]" rows the count did not
    // include, so the header said "1 comment" above two rows.
    const out = applyOptimisticDelete([c('a'), c('b')], 'b');
    expect(ids(out)).toEqual(['a']);
  });

  it('keeps a deleted comment that still holds replies up', () => {
    const out = applyOptimisticDelete([c('a'), c('a1', 'a')], 'a');
    expect(ids(out)).toEqual(['a', 'a1']);
    expect(out.find((x) => x.id === 'a').isDeleted).toBe(true);
  });

  it('scrubs the content and attribution of a retained placeholder', () => {
    const out = applyOptimisticDelete([c('a'), c('a1', 'a')], 'a');
    const placeholder = out.find((x) => x.id === 'a');
    expect(placeholder).toMatchObject({
      isDeleted: true, deletedByUser: true, text: null, author: null, authorId: null, likeCount: 0,
    });
    // Structure survives so the reply underneath still has a parent to hang from.
    expect(placeholder.parentId).toBe(null);
    expect(placeholder.id).toBe('a');
  });

  it('cascades: removing the last live reply frees its deleted parent too', () => {
    // `a` is already a tombstone holding up `a1`. Deleting `a1` makes `a` a leaf,
    // so both should go in one pass.
    const tree = [c('a', null, { isDeleted: true, text: null, author: null }), c('a1', 'a')];
    expect(ids(applyOptimisticDelete(tree, 'a1'))).toEqual([]);
  });

  it('cascades through several levels of tombstone', () => {
    const tree = [
      c('a', null, { isDeleted: true }),
      c('b', 'a', { isDeleted: true }),
      c('d', 'b'),
    ];
    expect(ids(applyOptimisticDelete(tree, 'd'))).toEqual([]);
  });

  it('stops the cascade at the first live ancestor', () => {
    const tree = [c('a'), c('b', 'a', { isDeleted: true }), c('d', 'b')];
    expect(ids(applyOptimisticDelete(tree, 'd'))).toEqual(['a']);
  });

  it('leaves sibling threads untouched', () => {
    const tree = [c('a'), c('a1', 'a'), c('z'), c('z1', 'z')];
    expect(ids(applyOptimisticDelete(tree, 'z1'))).toEqual(['a', 'a1', 'z']);
  });

  it('is a no-op for an id that is not present', () => {
    const tree = [c('a'), c('a1', 'a')];
    expect(ids(applyOptimisticDelete(tree, 'nope'))).toEqual(['a', 'a1']);
  });

  it('handles an empty thread', () => {
    expect(applyOptimisticDelete([], 'a')).toEqual([]);
  });
});
