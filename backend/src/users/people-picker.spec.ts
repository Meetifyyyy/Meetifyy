import {
  PickerSocial,
  closestIds,
  matchTier,
  rankPickerCandidates,
  socialScore,
} from './people-picker';

const social = (over: Partial<PickerSocial> = {}): PickerSocial => ({
  recentChat: new Map(),
  following: new Set(),
  followers: new Set(),
  affinity: new Map(),
  collegeId: null,
  ...over,
});
const u = (
  id: string,
  username: string,
  displayName = '',
  collegeId: string | null = null,
) => ({
  id,
  username,
  displayName,
  collegeId,
});

describe('matchTier', () => {
  it('ranks exact, then starts-with (incl. a later word), then contains', () => {
    expect(matchTier(u('1', 'asha'), 'Asha')).toBe(3);
    expect(matchTier(u('1', 'ashley'), 'ash')).toBe(2);
    expect(matchTier(u('1', 'kvn', 'Riya Sharma'), 'sha')).toBe(2);
    expect(matchTier(u('1', 'prakash'), 'ash')).toBe(1);
    expect(matchTier(u('1', 'anyone'), '  ')).toBe(0);
  });
});

describe('socialScore', () => {
  it('puts a recent chat above a mutual above a one-way follow', () => {
    const s = social({
      recentChat: new Map([['chat', 0]]),
      following: new Set(['mutual', 'oneway']),
      followers: new Set(['mutual']),
    });
    expect(socialScore('chat', s)).toBeGreaterThan(socialScore('mutual', s));
    expect(socialScore('mutual', s)).toBeGreaterThan(socialScore('oneway', s));
    expect(socialScore('stranger', s)).toBe(0);
  });

  it('prefers the more recent conversation', () => {
    const s = social({
      recentChat: new Map([
        ['a', 0],
        ['b', 5],
      ]),
    });
    expect(socialScore('a', s)).toBeGreaterThan(socialScore('b', s));
  });
});

describe('socialScore with learned affinity', () => {
  it('lifts the person the viewer engages with most above someone merely followed', () => {
    const s = social({
      following: new Set(['close', 'followed']),
      affinity: new Map([['close', 1]]),
    });
    expect(socialScore('close', s)).toBeGreaterThan(socialScore('followed', s));
  });

  it('keeps the latest chat above affinity alone', () => {
    const s = social({
      recentChat: new Map([['chat', 0]]),
      affinity: new Map([['engaged', 1]]),
    });
    expect(socialScore('chat', s)).toBeGreaterThan(socialScore('engaged', s));
  });

  it('clamps a score outside 0..1', () => {
    const s = social({
      affinity: new Map([
        ['a', 7],
        ['b', -3],
      ]),
    });
    expect(socialScore('a', s)).toBe(40);
    expect(socialScore('b', s)).toBe(0);
  });
});

describe('rankPickerCandidates', () => {
  it('lets match quality beat closeness', () => {
    const s = social({ recentChat: new Map([['friend', 0]]) });
    const ranked = rankPickerCandidates(
      [u('friend', 'prakash'), u('stranger', 'ashley')],
      'ash',
      s,
    );
    expect(ranked.map((r) => r.id)).toEqual(['stranger', 'friend']);
  });

  it('orders by closeness, then campus, within a tier', () => {
    const s = social({ following: new Set(['f']), collegeId: 'c1' });
    const ranked = rankPickerCandidates(
      [
        u('x', 'ana', '', null),
        u('c', 'anb', '', 'c1'),
        u('f', 'anc', '', null),
      ],
      '',
      s,
      new Set(['c']),
    );
    expect(ranked.map((r) => r.id)).toEqual(['f', 'c', 'x']);
  });

  it('boosts only verified campus peers, never the collegeId mirror alone', () => {
    const s = social({ collegeId: 'c1' });
    const ranked = rankPickerCandidates(
      // `mirror` carries the viewer's college on User.collegeId but holds no
      // active affiliation; `peer` holds one.
      [u('mirror', 'ana', '', 'c1'), u('peer', 'anz', '', null)],
      '',
      s,
      new Set(['peer']),
    );
    expect(ranked.map((r) => r.id)).toEqual(['peer', 'mirror']);
  });
});

describe('closestIds with learned affinity', () => {
  it('puts recent chats first, then people by affinity, then follows', () => {
    const s = social({
      recentChat: new Map([['chat', 0]]),
      affinity: new Map([
        ['low', 0.2],
        ['high', 0.9],
      ]),
      following: new Set(['followed']),
    });
    expect(closestIds(s, 10)).toEqual(['chat', 'high', 'low', 'followed']);
  });
});

describe('closestIds', () => {
  it('lists recent chats in order, then mutuals, follows, followers, capped', () => {
    const s = social({
      recentChat: new Map([
        ['late', 3],
        ['early', 0],
      ]),
      following: new Set(['oneway', 'mutual']),
      followers: new Set(['mutual', 'fan']),
    });
    expect(closestIds(s, 10)).toEqual([
      'early',
      'late',
      'mutual',
      'oneway',
      'fan',
    ]);
    expect(closestIds(s, 2)).toEqual(['early', 'late']);
  });
});
