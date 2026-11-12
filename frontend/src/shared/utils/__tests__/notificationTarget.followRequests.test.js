import { describe, expect, it } from 'vitest';
import { notificationTargetPath } from '../notificationTarget';

describe('notificationTargetPath - follow requests', () => {
  it('a request opens the requests page', () => {
    expect(notificationTargetPath({ type: 'FOLLOW_REQUEST', actor: { username: 'asha' } }))
      .toBe('/notifications/follow-requests');
  });

  it('an acceptance opens the accepter\'s profile', () => {
    expect(notificationTargetPath({ type: 'FOLLOW_ACCEPTED', actor: { username: 'asha' } }))
      .toBe('/profile/asha');
  });

  it('an acceptance with no username has nowhere to go', () => {
    expect(notificationTargetPath({ type: 'FOLLOW_ACCEPTED' })).toBeNull();
  });
});
