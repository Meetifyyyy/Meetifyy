import { BadRequestException } from '@nestjs/common';
import {
  CONFESSION_SHARE,
  inviteSummary,
  storableInviteData,
  withInviteExpiry,
} from './invite-data';

const ID = '3f1c2b9e-8a4d-4c6e-9b7a-1d2e3f4a5b6c';

describe('storableInviteData', () => {
  it('keeps only the id of a shared confession', () => {
    // A client (or a tampered one) sending the text, handle or anything else
    // must not get it stored: the message would keep it after a takedown.
    expect(
      storableInviteData({
        type: CONFESSION_SHARE,
        confessionId: ID,
        content: 'the secret',
        handle: 'NightOwl',
        confession: { id: ID, content: 'the secret' },
      }),
    ).toEqual({ type: CONFESSION_SHARE, confessionId: ID });
  });

  it.each([undefined, '', 'not-a-uuid', 42])(
    'refuses a shared confession with confessionId %p',
    (confessionId) => {
      expect(() =>
        storableInviteData({ type: CONFESSION_SHARE, confessionId }),
      ).toThrow(BadRequestException);
    },
  );

  it('passes every other kind through untouched', () => {
    const post = { type: 'postShare', post: { id: 'p1', text: 'hi' } };
    expect(storableInviteData(post)).toBe(post);
    const invite = { groupId: 'g1', groupName: 'Chess' };
    expect(storableInviteData(invite)).toBe(invite);
    expect(storableInviteData(null)).toBeNull();
    expect(storableInviteData(undefined)).toBeUndefined();
  });

  it('is not mistaken for a group invite, so gets no expiry', () => {
    const stored = storableInviteData({
      type: CONFESSION_SHARE,
      confessionId: ID,
    });
    expect(withInviteExpiry(stored)).toEqual({
      type: CONFESSION_SHARE,
      confessionId: ID,
    });
  });
});

describe('inviteSummary', () => {
  it.each([
    [{ type: CONFESSION_SHARE, confessionId: ID }, 'Shared a confession'],
    [{ type: 'postShare' }, 'Shared a post'],
    [{ type: 'profileShare' }, 'Shared a profile'],
    [{ type: 'communityShare' }, 'Shared a community'],
    [{ type: 'activityShare' }, 'Shared an activity'],
    [{ groupId: 'g', groupName: 'Chess' }, 'Group invite: Chess'],
    [{ groupId: 'g' }, null],
    [null, null],
  ])('%p → %p', (invite, expected) => {
    expect(inviteSummary(invite)).toBe(expected);
  });
});
