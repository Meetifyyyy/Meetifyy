import { describe, expect, it } from 'vitest';
import {
  isConversationUnavailable,
  matchesRecipientSearch,
  sendableConversations,
} from '../conversationTargets';

/**
 * Reported from the live app: the share and invite modals listed "Deleted
 * User" as somewhere you could send a post.
 *
 * The chat list is right to keep those threads — the history belongs to both
 * people — but a picker asking "where do you want to send this" must not offer
 * a destination the server will refuse.
 */
describe('conversation send targets', () => {
  const live = { id: 'c1', name: 'Priya', targetUser: { id: 'u1' } };
  const deleted = {
    id: 'c2',
    name: 'Deleted User',
    targetUserUnavailable: true,
    targetUser: { id: 'u2', isDeleted: true },
  };
  const group = { id: 'c3', name: 'Study group', isGroup: true };

  it('treats a live one-to-one thread as sendable', () => {
    expect(isConversationUnavailable(live)).toBe(false);
  });

  it('treats a thread with a deleted counterpart as unsendable', () => {
    expect(isConversationUnavailable(deleted)).toBe(true);
  });

  it('recognises either flag on its own', () => {
    // The list and the history endpoint each set one of these, so depending on
    // just one would leave the other surface leaking.
    expect(isConversationUnavailable({ targetUserUnavailable: true })).toBe(true);
    expect(isConversationUnavailable({ targetUser: { isDeleted: true } })).toBe(
      true
    );
  });

  it('keeps groups, where the rest of the members can still receive', () => {
    // The backend only refuses a one-to-one thread whose sole counterpart is
    // gone; a group with one departed member is still a real destination.
    expect(isConversationUnavailable(group)).toBe(false);
  });

  it('filters a picker list down to real destinations', () => {
    expect(sendableConversations([live, deleted, group])).toEqual([live, group]);
  });

  it('handles an absent or empty list', () => {
    expect(sendableConversations(null)).toEqual([]);
    expect(sendableConversations([])).toEqual([]);
  });

  it('treats a missing conversation as unavailable rather than sendable', () => {
    // Failing closed: a picker should drop a row it cannot judge rather than
    // offer a send that errors.
    expect(isConversationUnavailable(null)).toBe(true);
    expect(isConversationUnavailable(undefined)).toBe(true);
  });
});

/**
 * `matchesRecipientSearch` — the picker's client-side second line.
 *
 * The server matches the term against the group's name or the DM partner's
 * display name and username. This helper has to match the SAME fields: the
 * share modals used to test `conversation.name` alone, so a row the server
 * had correctly returned for a username match was thrown away in the browser
 * and searching by @handle found nothing.
 */
describe('matchesRecipientSearch', () => {
  const dm = {
    name: 'Anita Sharma',
    targetUser: { displayName: 'Anita Sharma', username: 'anita_cs25' },
  };
  const group = { name: 'Weekend Hike' };

  it('keeps everything when nothing has been typed', () => {
    expect(matchesRecipientSearch(dm, '')).toBe(true);
    expect(matchesRecipientSearch(group, '   ')).toBe(true);
  });

  it('matches a group on its name', () => {
    expect(matchesRecipientSearch(group, 'hike')).toBe(true);
    expect(matchesRecipientSearch(group, 'kayak')).toBe(false);
  });

  it('matches a DM on the handle, not only the rendered name', () => {
    expect(matchesRecipientSearch(dm, 'anita_cs25')).toBe(true);
    expect(matchesRecipientSearch(dm, 'cs25')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matchesRecipientSearch(dm, '  ANITA  ')).toBe(true);
  });

  it('reads the older `otherUser` shape too', () => {
    // Some conversation payloads carry the partner under `otherUser`. Missing
    // it would drop rows the server had deliberately returned.
    expect(
      matchesRecipientSearch({ otherUser: { username: 'bharat' } }, 'bharat'),
    ).toBe(true);
  });

  it('drops a row with a term and nothing to match it against', () => {
    expect(matchesRecipientSearch({}, 'anita')).toBe(false);
    expect(matchesRecipientSearch(null, 'anita')).toBe(false);
  });
});
