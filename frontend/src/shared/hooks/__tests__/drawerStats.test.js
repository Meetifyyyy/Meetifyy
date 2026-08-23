import { describe, it, expect } from 'vitest';

/**
 * The mobile drawer's follower / following counts.
 *
 * They were read straight off `currentUser`, the sign-in snapshot. That
 * object carries `followersList` and `followingList` arrays but no `stats`
 * object and no numeric counts — so the Followers chain had no path to a
 * real value and rendered 0 for every user, permanently. Following only
 * looked correct because its chain happened to fall through to
 * `followingList.length`.
 *
 * These pin the resolution order now that the live profile query is the
 * primary source, with the auth lists kept for first paint.
 */
const followers = (profile, currentUser) =>
  profile?.stats?.followers
  ?? profile?.followersCount
  ?? currentUser?.followersList?.length
  ?? 0;

const following = (profile, currentUser) =>
  profile?.stats?.following
  ?? profile?.followingCount
  ?? currentUser?.followingList?.length
  ?? 0;

/** Exactly what /auth/sync returns: lists, no counts, no stats. */
const authUser = (over = {}) => ({
  id: 'u1', username: 'gyu',
  followersList: ['a', 'b', 'c'],
  followingList: ['x', 'y', 'z', 'p', 'q'],
  ...over,
});

describe('the old behaviour, reproduced', () => {
  const oldFollowers = (u) => u?.stats?.followers ?? u?.followers ?? 0;

  it('showed zero followers for a user who has three', () => {
    // The bug in one line: no `stats`, no `followers`, so it fell to 0.
    expect(oldFollowers(authUser())).toBe(0);
  });
});

describe('followers', () => {
  it('prefers the live profile stat', () => {
    expect(followers({ stats: { followers: 42 } }, authUser())).toBe(42);
  });

  it('falls back to the auth list before the query resolves', () => {
    // First paint shows something true rather than a zero that then jumps.
    expect(followers(undefined, authUser())).toBe(3);
  });

  it('reports a genuine zero rather than falling through it', () => {
    // 0 is a real answer; `??` must not treat it as missing.
    expect(followers({ stats: { followers: 0 } }, authUser())).toBe(0);
  });

  it('handles a user with nothing at all', () => {
    expect(followers(undefined, undefined)).toBe(0);
    expect(followers(undefined, { username: 'new' })).toBe(0);
  });
});

describe('following', () => {
  it('prefers the live profile stat', () => {
    expect(following({ stats: { following: 7 } }, authUser())).toBe(7);
  });

  it('falls back to the auth list', () => {
    expect(following(undefined, authUser())).toBe(5);
  });

  it('reports a genuine zero', () => {
    expect(following({ stats: { following: 0 } }, authUser())).toBe(0);
  });
});

describe('staying in sync', () => {
  it('follows the profile query as a follow is applied to it', () => {
    // useFollowMutation writes stats.following to PROFILE_KEYS for the
    // current user, and the realtime handler writes stats.followers — both
    // to the query this now reads, so the drawer tracks them immediately.
    let profile = { stats: { followers: 3, following: 5 } };
    expect(following(profile, authUser())).toBe(5);

    profile = { ...profile, stats: { ...profile.stats, following: 6 } };
    expect(following(profile, authUser())).toBe(6);

    profile = { ...profile, stats: { ...profile.stats, followers: 4 } };
    expect(followers(profile, authUser())).toBe(4);
  });

  it('does not let the stale auth snapshot override live data', () => {
    // The auth lists say 3/5 forever; the live query is what moved.
    const stale = authUser();
    const live = { stats: { followers: 11, following: 9 } };
    expect(followers(live, stale)).toBe(11);
    expect(following(live, stale)).toBe(9);
  });
});
