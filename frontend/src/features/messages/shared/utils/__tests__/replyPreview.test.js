import { describe, expect, it } from 'vitest';
import { resolveReplyPreview } from '../replyPreview';

/**
 * The shape InviteModal actually sends. Pinned against the real producer,
 * because the resolver reading a field the sender never sets is exactly how the
 * group avatar went missing from quotes.
 */
const groupInvite = (overrides = {}) => ({
  inviteData: {
    groupId: 'g_123',
    conversationId: 'g_123',
    groupName: 'YEs',
    groupAvatar: 'groups/g_123/avatar.webp',
    type: 'group_invite',
    ...overrides,
  },
});

describe('a quoted group invite', () => {
  it('is recognised as a group invite, not a generic message', () => {
    // The kind is what makes ReplyPreviewContent choose the group avatar
    // treatment over a line icon, so getting it wrong shows a person glyph.
    expect(resolveReplyPreview(groupInvite()).kind).toBe('group_invite');
  });

  it('is titled with the group name', () => {
    expect(resolveReplyPreview(groupInvite()).text).toBe('YEs');
  });

  it('carries the group avatar as the snapshot fallback', () => {
    expect(resolveReplyPreview(groupInvite()).avatarKey).toBe('groups/g_123/avatar.webp');
  });

  it('carries the group id, which is how the live avatar is looked up', () => {
    /**
     * ReplyEntityAvatar resolves the CURRENT avatar from the conversation list
     * using this id. Without it the quote can only ever show the snapshot taken
     * when the invite was sent, which is stale the moment the group changes its
     * picture.
     */
    expect(resolveReplyPreview(groupInvite()).entityId).toBe('g_123');
  });

  it('falls back to the conversation id when there is no group id', () => {
    const msg = groupInvite();
    delete msg.inviteData.groupId;
    expect(resolveReplyPreview(msg).entityId).toBe('g_123');
  });

  it('still labels the quote when the sender had no avatar to snapshot', () => {
    // The renderer then draws a lettered circle, which is the point: an absent
    // picture must not degrade into an anonymous person.
    const preview = resolveReplyPreview(groupInvite({ groupAvatar: null }));
    expect(preview.kind).toBe('group_invite');
    expect(preview.avatarKey).toBeNull();
    expect(preview.text).toBe('YEs');
  });

  it('names it "Group invite" when even the name is missing', () => {
    const preview = resolveReplyPreview(groupInvite({ groupName: '' }));
    expect(preview.text).toBe('Group invite');
  });
});

describe('the server-flattened snapshot of the same invite', () => {
  // A stored reply arrives flattened rather than as the live object, and the
  // quote must look identical either way.
  const flattened = {
    shareType: 'group_invite',
    shareId: 'g_123',
    shareTitle: 'YEs',
    shareAvatar: 'groups/g_123/avatar.webp',
  };

  it('resolves to the same preview as the live shape', () => {
    const live = resolveReplyPreview(groupInvite());
    const snap = resolveReplyPreview(flattened);
    expect(snap.kind).toBe(live.kind);
    expect(snap.text).toBe(live.text);
    expect(snap.avatarKey).toBe(live.avatarKey);
    expect(snap.entityId).toBe(live.entityId);
  });
});

describe('other quoted entities still resolve', () => {
  it('keeps a shared community distinct from a group invite', () => {
    // They take different live-lookup paths: a community is in the communities
    // cache, a group chat is in the conversation list. Conflating them is what
    // left group invites without an avatar.
    const preview = resolveReplyPreview({
      payload: { community: { id: 'c_1', name: 'Design', avatarKey: 'k' } },
    });
    expect(preview.kind).toBe('community');
    expect(preview.entityId).toBe('c_1');
  });

  it('keeps a shared profile distinct too', () => {
    const preview = resolveReplyPreview({
      payload: { profile: { id: 'u_1', displayName: 'Alice', avatar: 'a' } },
    });
    expect(preview.kind).toBe('profile');
    expect(preview.entityId).toBe('u_1');
  });

  it('never returns an empty quote', () => {
    for (const msg of [null, undefined, {}, { text: '' }]) {
      expect(resolveReplyPreview(msg).text).toBeTruthy();
    }
  });
});
