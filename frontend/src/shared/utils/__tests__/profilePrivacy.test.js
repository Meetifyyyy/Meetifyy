import { describe, expect, it } from 'vitest';
import { isHiddenFromViewer } from '../profilePrivacy';

describe('isHiddenFromViewer', () => {
  it('hides a private account from someone who does not follow it', () => {
    expect(isHiddenFromViewer({ isPrivate: true, isFollowing: false }, false)).toBe(true);
    expect(isHiddenFromViewer({ settings: { privateProfile: true }, isFollowing: false }, false)).toBe(true);
  });

  it('keeps hiding it while a follow request is pending', () => {
    expect(isHiddenFromViewer({ isPrivate: true, isFollowing: false, followRequested: true }, false)).toBe(true);
  });

  it('shows it to a follower, on a public account, and on the viewer\'s own profile', () => {
    expect(isHiddenFromViewer({ isPrivate: true, isFollowing: true }, false)).toBe(false);
    expect(isHiddenFromViewer({ isPrivate: false, isFollowing: false }, false)).toBe(false);
    expect(isHiddenFromViewer({ isPrivate: true, isFollowing: false }, true)).toBe(false);
    expect(isHiddenFromViewer(null, false)).toBe(false);
  });
});
