import { describe, expect, it } from 'vitest';
import { filterForwardTargets, forwardEmptyMessage } from '../forwardTargets';

const CHATS = [
  { id: '1', name: 'Zero', username: '0000' },
  { id: '2', name: 'Alice Chen', username: 'alice' },
  { id: '3', name: 'Design Crew', isGroup: true },
];

describe('filtering forward targets', () => {
  it('returns everything when nothing is typed', () => {
    expect(filterForwardTargets(CHATS, '')).toEqual(CHATS);
    expect(filterForwardTargets(CHATS, '   ')).toEqual(CHATS);
  });

  it('matches on display name, case-insensitively', () => {
    expect(filterForwardTargets(CHATS, 'alice').map((c) => c.id)).toEqual(['2']);
    expect(filterForwardTargets(CHATS, 'ALICE').map((c) => c.id)).toEqual(['2']);
  });

  it('matches on username too', () => {
    // The old filter only looked at `name`, so searching a handle found
    // nothing even when the chat was right there in the list.
    expect(filterForwardTargets(CHATS, '0000').map((c) => c.id)).toEqual(['1']);
  });

  it('matches groups, which have a name and no username', () => {
    expect(filterForwardTargets(CHATS, 'crew').map((c) => c.id)).toEqual(['3']);
  });

  it('returns nothing when there is no match', () => {
    expect(filterForwardTargets(CHATS, 'nobody')).toEqual([]);
  });

  it('survives a missing or malformed list', () => {
    // The list was `undefined` in production for as long as this modal existed,
    // because nothing passed the prop.
    expect(filterForwardTargets(undefined, 'a')).toEqual([]);
    expect(filterForwardTargets(null, '')).toEqual([]);
    expect(filterForwardTargets([null, undefined], 'a')).toEqual([]);
  });
});

describe('the empty state tells the truth', () => {
  /**
   * All three cases used to render "No conversations found". That is what let
   * a permanently broken list look like a legitimately empty one for so long.
   */
  it('says so while still loading', () => {
    expect(forwardEmptyMessage({ isLoading: true, searchQuery: '' })).toMatch(/loading/i);
  });

  it('blames the search when there is one', () => {
    expect(forwardEmptyMessage({ isLoading: false, searchQuery: 'zzz' })).toMatch(/search/i);
  });

  it('reports a genuinely empty list only when it is one', () => {
    const message = forwardEmptyMessage({ isLoading: false, searchQuery: '' });
    expect(message).toMatch(/no chats to forward/i);
    expect(message).not.toMatch(/loading|search/i);
  });

  it('prefers loading over the search message', () => {
    // Typing while the first page is still in flight must not claim the search
    // came back empty.
    expect(forwardEmptyMessage({ isLoading: true, searchQuery: 'zzz' })).toMatch(/loading/i);
  });
});
