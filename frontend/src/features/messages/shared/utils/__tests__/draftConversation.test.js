import { describe, expect, it } from 'vitest';
import {
  buildDraftConversation,
  draftConversationId,
  draftUserIdFromConversationId,
  isDraftConversationId,
} from '../draftConversation';

const ALICE = {
  id: 'u_alice',
  username: 'alice',
  displayName: 'Alice Chen',
  avatar: 'https://cdn.example/alice.png',
};
const ME = { id: 'u_me', username: 'me', displayName: 'Me' };

const draftFor = (targetUser) =>
  buildDraftConversation({
    conversationId: draftConversationId(ALICE.id),
    targetUserId: ALICE.id,
    targetUser,
    currentUser: ME,
  });

describe('draft conversation ids', () => {
  it('round-trips a user id through the synthetic route id', () => {
    const id = draftConversationId(ALICE.id);
    expect(isDraftConversationId(id)).toBe(true);
    expect(draftUserIdFromConversationId(id)).toBe(ALICE.id);
  });

  it('does not mistake a real conversation id for a draft', () => {
    expect(isDraftConversationId('c_12345')).toBe(false);
    expect(draftUserIdFromConversationId('c_12345')).toBeNull();
  });
});

describe('a draft with the recipient resolved', () => {
  /**
   * The bug: opening a chat from a profile navigated to /messages/new?user=<id>
   * and described the recipient ONLY in router state. On a reload, a pasted
   * link, or a back/forward restoration that drops state, the draft was named
   * "New Message" — and ChatDetailsPanel, which synthesises a user from `name`
   * when it has no `targetUser`, then showed a profile called "New Message".
   * Everything looked right only after the first message, because sending
   * creates the real conversation and the recipient arrives from the list.
   */
  const draft = draftFor(ALICE);

  it('names the thread after the person, not "New Message"', () => {
    expect(draft.name).toBe('Alice Chen');
    expect(draft.avatar).toBe(ALICE.avatar);
  });

  it('carries the recipient so the details panel does not have to invent one', () => {
    expect(draft.targetUser).toEqual(ALICE);
    expect(draft.targetUserId).toBe(ALICE.id);
  });

  it('carries the fields the details panel matches the users map on', () => {
    // Without these, a draft could only ever fall back to the synthetic user
    // built from `name`, even when the real record was already in the map.
    expect(draft.userId).toBe(ALICE.id);
    expect(draft.username).toBe('alice');
  });

  it('lists both participants so anything counting them sees a real pair', () => {
    expect(draft.participants).toHaveLength(2);
    expect(draft.participants.map((p) => p.userId).sort()).toEqual(
      [ALICE.id, ME.id].sort(),
    );
  });

  it('is still marked a draft, so send can create the conversation first', () => {
    expect(draft.isDraft).toBe(true);
    expect(draft.type).toBe('DM');
  });

  it('falls back to the username when there is no display name', () => {
    expect(draftFor({ ...ALICE, displayName: null }).name).toBe('alice');
  });
});

describe('a draft whose recipient has not resolved yet', () => {
  // The only state in which the placeholder is correct: the lookup is still in
  // flight. It must not leave the conversation half-described.
  const pending = draftFor(null);

  it('shows the placeholder name', () => {
    expect(pending.name).toBe('New Message');
  });

  it('still knows who the thread is with, so send works', () => {
    expect(pending.targetUserId).toBe(ALICE.id);
    expect(pending.userId).toBe(ALICE.id);
  });

  it('reports no participants rather than a one-person conversation', () => {
    // A list containing only the viewer reads as a conversation with yourself
    // to anything that counts it, which is worse than an empty list.
    expect(pending.participants).toEqual([]);
  });
});

describe('blocking from an empty chat', () => {
  /**
   * The bug: blocking from a draft reached the server, but nothing on screen
   * changed. Every surface reads `isBlockedByMe` off the conversation, and the
   * optimistic write in toggleBlockUser only touched the ['conversations']
   * cache, which a draft is not in and never will be until the first message
   * creates it. So the composer stayed enabled and the menu still offered
   * "Block Contact" for a contact that was already blocked.
   *
   * Refetching the user is not an alternative: /api/users/id/:id deliberately
   * 404s once a block exists, so it would erase the recipient the draft is
   * built from.
   */
  const blocked = buildDraftConversation({
    conversationId: draftConversationId(ALICE.id),
    targetUserId: ALICE.id,
    targetUser: ALICE,
    currentUser: ME,
    isBlockedByMe: true,
  });

  it('reports the block on the conversation the UI actually reads', () => {
    expect(blocked.isBlockedByMe).toBe(true);
  });

  it('sets the mutual field the composer disables on', () => {
    // DMChatArea derives `isBlocked` from `blocked` among others; without it
    // the input stays live next to a header that says Blocked.
    expect(blocked.blocked).toBe(true);
  });

  it('keeps the recipient, so the header does not fall back to a placeholder', () => {
    expect(blocked.name).toBe('Alice Chen');
    expect(blocked.targetUser).toEqual(ALICE);
  });

  it('defaults to not blocked', () => {
    const draft = draftFor(ALICE);
    expect(draft.isBlockedByMe).toBe(false);
    expect(draft.blocked).toBe(false);
  });

  it('clears cleanly on unblock', () => {
    const unblocked = buildDraftConversation({
      conversationId: draftConversationId(ALICE.id),
      targetUserId: ALICE.id,
      targetUser: ALICE,
      currentUser: ME,
      isBlockedByMe: false,
    });
    expect(unblocked.isBlockedByMe).toBe(false);
    expect(unblocked.blocked).toBe(false);
  });
});
