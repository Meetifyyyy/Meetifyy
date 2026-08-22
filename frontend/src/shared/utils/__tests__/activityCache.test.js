import { describe, it, expect } from 'vitest';
import { insertActivityIntoCache, replaceActivityInCache } from '../mapActivity';

const act = (id) => ({ id, title: `activity ${id}` });

// The three shapes an activities cache entry can take. Every writer used to
// understand only the first, so a newly created activity landed in the public
// feed and nowhere else — including the composed payload the Crew page renders.
const infinite = (ids) => ({ pages: [{ activities: ids.map(act) }], pageParams: [undefined] });
const discover = (sections) => Object.fromEntries(
  Object.entries(sections).map(([k, ids]) => [k, { items: ids.map(act), hasMore: false }]),
);

describe('insertActivityIntoCache', () => {
  it('prepends into the first page of an infinite list', () => {
    const next = insertActivityIntoCache(infinite(['a']), act('new'));
    expect(next.pages[0].activities.map((a) => a.id)).toEqual(['new', 'a']);
  });

  it('prepends into every section of the composed discover payload', () => {
    const next = insertActivityIntoCache(discover({ forYou: ['a'], college: ['b'], oneOnOne: [] }), act('new'));
    expect(next.forYou.items.map((a) => a.id)).toEqual(['new', 'a']);
    expect(next.college.items.map((a) => a.id)).toEqual(['new', 'b']);
    expect(next.oneOnOne.items.map((a) => a.id)).toEqual(['new']);
  });

  it('prepends into a flat list', () => {
    expect(insertActivityIntoCache([act('a')], act('new')).map((a) => a.id)).toEqual(['new', 'a']);
  });

  it('handles a bare-array page', () => {
    const old = { pages: [[act('a')]], pageParams: [undefined] };
    expect(insertActivityIntoCache(old, act('new')).pages[0].map((a) => a.id)).toEqual(['new', 'a']);
  });

  it('dedupes rather than duplicating on a second insert', () => {
    const once = insertActivityIntoCache(infinite(['a']), act('new'));
    const twice = insertActivityIntoCache(once, act('new'));
    expect(twice.pages[0].activities.map((a) => a.id)).toEqual(['new', 'a']);
  });

  it('only ever prepends to page one — later pages keep their order', () => {
    const old = { pages: [{ activities: [act('a')] }, { activities: [act('b')] }], pageParams: [undefined, 'c'] };
    const next = insertActivityIntoCache(old, act('new'));
    expect(next.pages[1].activities.map((a) => a.id)).toEqual(['b']);
  });

  it('leaves an absent cache absent', () => {
    expect(insertActivityIntoCache(undefined, act('new'))).toBeUndefined();
  });
});

describe('replaceActivityInCache', () => {
  it('swaps the optimistic placeholder for the server row, in place', () => {
    const old = insertActivityIntoCache(infinite(['a']), { id: 'optimistic_1', title: 'draft' });
    const next = replaceActivityInCache(old, 'optimistic_1', { id: 'real', title: 'saved' });
    expect(next.pages[0].activities.map((a) => a.id)).toEqual(['real', 'a']);
    expect(next.pages[0].activities[0].title).toBe('saved');
  });

  it('swaps inside the discover payload too', () => {
    const old = insertActivityIntoCache(discover({ forYou: [] }), { id: 'optimistic_1' });
    const next = replaceActivityInCache(old, 'optimistic_1', act('real'));
    expect(next.forYou.items.map((a) => a.id)).toEqual(['real']);
  });

  it('is a no-op when the placeholder is not present', () => {
    const old = infinite(['a']);
    expect(replaceActivityInCache(old, 'missing', act('real')).pages[0].activities.map((a) => a.id)).toEqual(['a']);
  });
});
