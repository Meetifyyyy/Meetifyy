/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readDraft,
  saveDraft,
  clearDraft,
  clearAllDrafts,
  MAX_DRAFTS_PER_USER,
  DRAFT_TTL_MS,
} from '../drafts';

const signIn = (id) => {
  localStorage.setItem('currentUser', JSON.stringify({ id }));
  localStorage.setItem('loggedIn', 'true');
};

const draftKeys = () =>
  Object.keys(localStorage).filter((k) => k.startsWith('meetifyy_draft:'));

beforeEach(() => {
  localStorage.clear();
  signIn('u1');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('drafts: save and read', () => {
  it('round-trips text under meetifyy_draft:v1:<user>:<scope>', () => {
    expect(saveDraft('chat:c1', 'hello there')).toBe(true);
    expect(draftKeys()).toEqual(['meetifyy_draft:v1:u1:chat:c1']);
    expect(readDraft('chat:c1')).toEqual({ text: 'hello there', mentions: [] });
  });

  it('keeps scopes apart', () => {
    saveDraft('chat:c1', 'one');
    saveDraft('chat:c2', 'two');
    expect(readDraft('chat:c1').text).toBe('one');
    expect(readDraft('chat:c2').text).toBe('two');
    expect(readDraft('chat:c3')).toBeNull();
  });

  it('scopes drafts by user: another account never sees them', () => {
    saveDraft('post:home', 'mine');
    signIn('u2');
    expect(readDraft('post:home')).toBeNull();
    saveDraft('post:home', 'theirs');
    signIn('u1');
    expect(readDraft('post:home').text).toBe('mine');
  });

  it('is a no-op with nobody signed in', () => {
    localStorage.setItem('loggedIn', 'false');
    expect(saveDraft('chat:c1', 'x')).toBe(false);
    expect(draftKeys()).toEqual([]);
    expect(readDraft('chat:c1')).toBeNull();

    localStorage.clear();
    expect(saveDraft('chat:c1', 'x')).toBe(false);
    expect(draftKeys()).toEqual([]);
  });

  it('survives a corrupt currentUser', () => {
    localStorage.setItem('currentUser', '{not json');
    expect(saveDraft('chat:c1', 'x')).toBe(false);
    expect(readDraft('chat:c1')).toBeNull();
  });

  it('empty or whitespace-only text deletes the draft', () => {
    saveDraft('chat:c1', 'something');
    expect(saveDraft('chat:c1', '   \n ')).toBe(false);
    expect(draftKeys()).toEqual([]);

    saveDraft('chat:c1', 'again');
    saveDraft('chat:c1', '');
    expect(readDraft('chat:c1')).toBeNull();
  });

  it('cuts text to the composer limit without splitting an emoji', () => {
    saveDraft('comment:p1', 'ab😀cd', { maxLength: 3 });
    expect(readDraft('comment:p1').text).toBe('ab');
    saveDraft('comment:p1', 'abcdef', { maxLength: 4 });
    expect(readDraft('comment:p1').text).toBe('abcd');
  });

  it('clearDraft removes only that scope', () => {
    saveDraft('chat:c1', 'a');
    saveDraft('chat:c2', 'b');
    clearDraft('chat:c1');
    expect(readDraft('chat:c1')).toBeNull();
    expect(readDraft('chat:c2').text).toBe('b');
  });
});

describe('drafts: mentions', () => {
  const mention = { userId: 'u9', username: 'sam', start: 3, end: 7 };

  it('restores mentions that still line up with the text', () => {
    saveDraft('chat:c1', 'hi @sam!', { mentions: [mention] });
    expect(readDraft('chat:c1').mentions).toEqual([mention]);
  });

  it('drops mentions that no longer point at their @username', () => {
    saveDraft('chat:c1', 'hi @sam!', {
      mentions: [mention, { ...mention, username: 'kim' }, { ...mention, start: 90, end: 94 }, null],
    });
    expect(readDraft('chat:c1').mentions).toEqual([mention]);
  });

  it('re-validates on read, so a tampered entry cannot misplace a mention', () => {
    saveDraft('chat:c1', 'hi @sam!', { mentions: [mention] });
    const key = draftKeys()[0];
    const entry = JSON.parse(localStorage.getItem(key));
    entry.text = 'hey @sam!';
    localStorage.setItem(key, JSON.stringify(entry));
    expect(readDraft('chat:c1').mentions).toEqual([]);
  });
});

describe('drafts: bounds', () => {
  it('keeps at most 50 per user and evicts the oldest by savedAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    for (let i = 0; i < MAX_DRAFTS_PER_USER; i += 1) {
      saveDraft(`chat:${i}`, `draft ${i}`);
      vi.advanceTimersByTime(1000);
    }
    expect(draftKeys()).toHaveLength(MAX_DRAFTS_PER_USER);

    saveDraft('chat:new', 'newest');
    expect(draftKeys()).toHaveLength(MAX_DRAFTS_PER_USER);
    expect(readDraft('chat:0')).toBeNull();
    expect(readDraft('chat:1').text).toBe('draft 1');
    expect(readDraft('chat:new').text).toBe('newest');
  });

  it('rewriting an existing draft at the cap evicts nothing', () => {
    for (let i = 0; i < MAX_DRAFTS_PER_USER; i += 1) saveDraft(`chat:${i}`, 'x');
    saveDraft('chat:7', 'edited');
    expect(draftKeys()).toHaveLength(MAX_DRAFTS_PER_USER);
    expect(readDraft('chat:0')).not.toBeNull();
  });

  it("does not count or evict another user's drafts", () => {
    signIn('u2');
    saveDraft('chat:other', 'theirs');
    signIn('u1');
    for (let i = 0; i < MAX_DRAFTS_PER_USER + 3; i += 1) saveDraft(`chat:${i}`, 'x');
    signIn('u2');
    expect(readDraft('chat:other').text).toBe('theirs');
  });

  it('ignores and removes a draft older than 7 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    saveDraft('chat:c1', 'old');
    vi.setSystemTime(Date.now() + DRAFT_TTL_MS - 1000);
    expect(readDraft('chat:c1').text).toBe('old');
    vi.setSystemTime(Date.now() + 2000);
    expect(readDraft('chat:c1')).toBeNull();
    expect(draftKeys()).toEqual([]);
  });

  it('removes a corrupt entry when it is read', () => {
    localStorage.setItem('meetifyy_draft:v1:u1:chat:c1', '{oops');
    expect(readDraft('chat:c1')).toBeNull();
    expect(draftKeys()).toEqual([]);
    localStorage.setItem('meetifyy_draft:v1:u1:chat:c1', JSON.stringify({ text: 5 }));
    expect(readDraft('chat:c1')).toBeNull();
    expect(draftKeys()).toEqual([]);
  });
});

describe('drafts: clearAllDrafts', () => {
  it('removes every draft of every user and nothing else', () => {
    saveDraft('chat:c1', 'a');
    signIn('u2');
    saveDraft('post:home', 'b');
    localStorage.setItem('theme', 'dark');

    clearAllDrafts();

    expect(draftKeys()).toEqual([]);
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('loggedIn')).toBe('true');
  });

  it('works after sign-out, when the user can no longer be resolved', () => {
    saveDraft('chat:c1', 'a');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('loggedIn');
    clearAllDrafts();
    expect(draftKeys()).toEqual([]);
  });
});

describe('drafts: storage failures never throw', () => {
  it('quota errors on write return false', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => saveDraft('chat:c1', 'x')).not.toThrow();
    expect(saveDraft('chat:c1', 'x')).toBe(false);
  });

  it('a throwing getItem yields no draft', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readDraft('chat:c1')).toBeNull();
    expect(() => clearDraft('chat:c1')).not.toThrow();
    expect(saveDraft('chat:c1', 'x')).toBe(false);
  });

  it('removeItem failures do not escape clear functions', () => {
    saveDraft('chat:c1', 'x');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => clearDraft('chat:c1')).not.toThrow();
    expect(() => clearAllDrafts()).not.toThrow();
  });

  it('blocked localStorage entirely is a quiet no-op', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readDraft('chat:c1')).toBeNull();
    expect(saveDraft('chat:c1', 'x')).toBe(false);
    expect(() => clearDraft('chat:c1')).not.toThrow();
    expect(() => clearAllDrafts()).not.toThrow();
  });
});

describe('drafts belong to the account that typed them', () => {
  it('refuses a save whose typist is no longer the signed-in account', async () => {
    const { saveDraft, readDraft, draftOwner } = await import('../drafts');
    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('currentUser', JSON.stringify({ id: 'alice' }));
    const typedBy = draftOwner();
    // Account switch while the composer still held unsaved text.
    localStorage.setItem('currentUser', JSON.stringify({ id: 'bob' }));
    expect(saveDraft('chat:c1', 'alice was typing this', { owner: typedBy })).toBe(false);
    expect(readDraft('chat:c1')).toBeNull();
    expect(saveDraft('chat:c1', 'bob types', { owner: draftOwner() })).toBe(true);
  });
});
