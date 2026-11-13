import { describe, it, expect } from 'vitest';
import { inviteErrorCode, inviteErrorMessage } from '../useGroupInvite';
import { GROUP_FULL_MESSAGE, MAX_GROUP_MEMBERS } from '@features/messages/shared/utils/groupMembership';

/**
 * A join through a link, or a request to join, into a full group is refused
 * with `code: GROUP_FULL`. It used to fall through to "Couldn't join the
 * group. Please try again." — advice no retry could follow.
 */
describe('joining a full group', () => {
  it('names the reason instead of suggesting a retry', () => {
    const err = Object.assign(new Error('This group is full.'), { status: 400, code: 'GROUP_FULL' });
    expect(inviteErrorCode(err)).toBe('GROUP_FULL');
    expect(inviteErrorMessage(err)).toBe(GROUP_FULL_MESSAGE);
    expect(GROUP_FULL_MESSAGE).toContain(String(MAX_GROUP_MEMBERS));
  });
});
