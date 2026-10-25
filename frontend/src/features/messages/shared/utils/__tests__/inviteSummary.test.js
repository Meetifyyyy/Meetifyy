import { describe, expect, it } from 'vitest';
import { inviteSummary } from '../inviteSummary';

describe('inviteSummary', () => {
  it.each([
    [{ type: 'confessionShare', confessionId: 'cf1' }, 'Shared a confession'],
    [{ type: 'postShare', post: { id: 'p' } }, 'Shared a post'],
    [{ type: 'profileShare' }, 'Shared a profile'],
    [{ type: 'communityShare' }, 'Shared a community'],
    [{ type: 'activityShare' }, 'Shared an activity'],
    [{ groupId: 'g', groupName: 'Chess' }, 'Group invite: Chess'],
    [{ groupId: 'g' }, 'Group invite'],
    [null, null],
  ])('%j → %s', (invite, expected) => {
    expect(inviteSummary(invite)).toBe(expected);
  });

  it('never reads the content of what was shared', () => {
    expect(inviteSummary({ type: 'confessionShare', confessionId: 'cf1', content: 'the secret' })).not.toMatch(/secret/);
  });
});
