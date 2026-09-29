import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (v) => (v ? (v.startsWith('http') ? v : `https://api.test${v.startsWith('/') ? '' : '/'}${v}`) : ''),
}));

import { SHARE_KIND, normalizeShareContent, normalizePoll, toChatInvite, memberCountOf } from '../content';

describe('normalizeShareContent', () => {
  it('returns null for something that cannot be addressed', () => {
    expect(normalizeShareContent(SHARE_KIND.POST, { text: 'x' })).toBeNull();
    expect(normalizeShareContent(SHARE_KIND.PROFILE, { id: 'u1' })).toBeNull();
    expect(normalizeShareContent('nope', { id: 'x' })).toBeNull();
    expect(normalizeShareContent(SHARE_KIND.POST, null)).toBeNull();
  });

  it('reads post media from every historical shape', () => {
    const current = normalizeShareContent(SHARE_KIND.POST, {
      id: 'p', media: [{ objectKey: 'a.jpg' }, 'b.jpg'],
    });
    expect(current.images).toEqual(['https://api.test/api/media/a.jpg', 'https://api.test/b.jpg']);
    const single = normalizeShareContent(SHARE_KIND.POST, { id: 'p', image: { storageKey: 'c.jpg' } });
    expect(single.images).toEqual(['https://api.test/api/media/c.jpg']);
    const none = normalizeShareContent(SHARE_KIND.POST, { id: 'p', text: 'hi' });
    expect(none.images).toEqual([]);
  });

  it('keeps photos typed the way the feed types them, and drops videos', () => {
    const post = normalizeShareContent(SHARE_KIND.POST, {
      id: 'p',
      media: [{ url: 'a.webp', type: 'IMAGE' }, { url: 'b.jpg', mimeType: 'image/jpeg' }, { url: 'c.mp4' }, { url: 'd.bin', type: 'video' }],
    });
    expect(post.images).toEqual(['https://api.test/a.webp', 'https://api.test/b.jpg']);
  });

  it('uses the canonical routes the router actually has', () => {
    expect(normalizeShareContent(SHARE_KIND.POST, { id: 'p1' }).url).toMatch(/\/post\/p1$/);
    expect(normalizeShareContent(SHARE_KIND.PROFILE, { username: 'alex' }).url).toMatch(/\/profile\/alex$/);
    expect(normalizeShareContent(SHARE_KIND.COMMUNITY, { id: 'c1' }).url).toMatch(/\/communities\/c1$/);
    expect(normalizeShareContent(SHARE_KIND.ACTIVITY, { id: 'a1' }).url).toMatch(/\/crew\/a1$/);
  });

  it('treats gradient and default covers correctly', () => {
    const g = normalizeShareContent(SHARE_KIND.PROFILE, { username: 'a', cover: 'linear-gradient(90deg, #fff, #000)' });
    expect(g.cover.type).toBe('gradient');
    const d = normalizeShareContent(SHARE_KIND.PROFILE, { username: 'a', cover: '/api/media/defaults/x.jpg' });
    expect(d.cover.type).toBe('empty');
  });

  it('counts members from any shape', () => {
    expect(memberCountOf({ memberCount: 12 })).toBe(12);
    expect(memberCountOf({ membersCount: [1, 2] })).toBe(2);
    expect(memberCountOf({ members: [1, 2, 3] })).toBe(3);
    expect(memberCountOf({})).toBe(0);
  });
});

describe('normalizePoll', () => {
  it('reads the feed shape with parallel vote counts', () => {
    const poll = normalizePoll({ poll: { question: 'Q', options: ['A', { text: 'B' }], votes: [3, 1] } });
    expect(poll).toEqual({
      question: 'Q',
      options: [{ id: undefined, text: 'A', votes: 3 }, { id: undefined, text: 'B', votes: 1 }],
      totalVotes: 4,
    });
  });

  it('reads the flat legacy shape', () => {
    const poll = normalizePoll({ pollOptions: [{ id: 'o', label: 'Yes', voteCount: 2 }] });
    expect(poll.options[0]).toEqual({ id: 'o', text: 'Yes', votes: 2 });
  });

  it('is null without options', () => {
    expect(normalizePoll({ poll: { options: [] } })).toBeNull();
    expect(normalizePoll({})).toBeNull();
  });
});

describe('toChatInvite', () => {
  // These shapes are read by the chat previews of every installed app.
  it('keeps the post payload fields the preview reads', () => {
    const post = { id: 'p', text: 'hello', authorAvatar: 'raw-key', media: ['a.jpg'], createdAt: 't' };
    const content = normalizeShareContent(SHARE_KIND.POST, post, { author: { username: 'al', displayName: 'Al' } });
    const invite = toChatInvite(content, post);
    expect(invite.type).toBe('postShare');
    expect(invite.post).toMatchObject({
      id: 'p', text: 'hello', authorName: 'Al', authorUsername: 'al', authorAvatar: 'raw-key',
      image: 'https://api.test/a.jpg', mediaUrl: 'https://api.test/a.jpg', createdAt: 't', poll: null,
    });
  });

  it('sends a member COUNT for a community, never the array', () => {
    const community = { id: 'c', name: 'Chess', members: [{}, {}], avatarKey: 'k' };
    const invite = toChatInvite(normalizeShareContent(SHARE_KIND.COMMUNITY, community), community);
    expect(invite).toEqual({
      type: 'communityShare',
      community: { id: 'c', name: 'Chess', avatar: 'k', color: undefined, description: '', membersCount: 2 },
    });
  });

  it('keeps the profile and activity shapes', () => {
    const user = { id: 'u', username: 'al', displayName: 'Al', avatar: 'a', bio: 'b', stats: { followers: 3, following: 4 } };
    expect(toChatInvite(normalizeShareContent(SHARE_KIND.PROFILE, user), user)).toEqual({
      type: 'profileShare',
      profile: { id: 'u', username: 'al', displayName: 'Al', avatar: 'a', bio: 'b', followers: 3, following: 4 },
    });
    const activity = { id: 'a', title: 'Run', time: '6pm', location: 'Park' };
    const invite = toChatInvite(normalizeShareContent(SHARE_KIND.ACTIVITY, activity), activity);
    expect(invite.type).toBe('activityShare');
    expect(invite.activity).toMatchObject({ id: 'a', title: 'Run', time: '6pm', location: 'Park' });
  });
});
