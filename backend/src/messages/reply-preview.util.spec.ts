import { buildReplyToSnapshot, REPLY_TO_SELECT } from './reply-preview.util';

describe('buildReplyToSnapshot', () => {
  // ── Null / missing input ─────────────────────────────────────────────────

  describe('null / missing replyTo', () => {
    it('returns null when replyTo is null', () => {
      expect(buildReplyToSnapshot(null, 'viewer-1')).toBeNull();
    });

    it('returns null when replyTo is undefined', () => {
      expect(buildReplyToSnapshot(undefined, 'viewer-1')).toBeNull();
    });
  });

  // ── Basic text message ───────────────────────────────────────────────────

  describe('plain text message', () => {
    const msg = {
      id: 'msg-1',
      senderId: 'alice',
      state: null,
      payload: { text: 'Hello there' },
      sender: { displayName: 'Alice Smith', username: 'alice' },
    };

    it('carries the message id', () => {
      expect(buildReplyToSnapshot(msg, 'alice')!.id).toBe('msg-1');
    });

    it('derives senderName from displayName', () => {
      expect(buildReplyToSnapshot(msg, 'viewer-1')!.senderName).toBe('Alice Smith');
    });

    it('falls back to username when displayName is absent', () => {
      const m = { ...msg, sender: { displayName: null, username: 'alice' } };
      expect(buildReplyToSnapshot(m, 'viewer-1')!.senderName).toBe('alice');
    });

    it('sets from="me" when senderId matches viewerId', () => {
      expect(buildReplyToSnapshot(msg, 'alice')!.from).toBe('me');
    });

    it('sets from="them" when senderId differs from viewerId', () => {
      expect(buildReplyToSnapshot(msg, 'bob')!.from).toBe('them');
    });

    it('carries the text payload', () => {
      expect(buildReplyToSnapshot(msg, 'bob')!.text).toBe('Hello there');
    });

    it('has null media fields for a text-only message', () => {
      const snap = buildReplyToSnapshot(msg, 'bob')!;
      expect(snap.mediaType).toBeNull();
      expect(snap.mediaUrl).toBeNull();
      expect(snap.thumbnailUrl).toBeNull();
    });

    it('isUnsent is false', () => {
      expect(buildReplyToSnapshot(msg, 'bob')!.isUnsent).toBe(false);
    });
  });

  // ── Media message ────────────────────────────────────────────────────────

  describe('media message', () => {
    const mediaMsg = {
      id: 'msg-2',
      senderId: 'bob',
      state: null,
      payload: {
        text: '',
        mediaType: 'image',
        mediaUrl: 'https://cdn.example.com/img.jpg',
        thumbnailUrl: 'https://cdn.example.com/img-thumb.jpg',
      },
      sender: { displayName: 'Bob', username: 'bob' },
    };

    it('carries mediaType from payload', () => {
      expect(buildReplyToSnapshot(mediaMsg, 'alice')!.mediaType).toBe('image');
    });

    it('carries mediaUrl', () => {
      expect(buildReplyToSnapshot(mediaMsg, 'alice')!.mediaUrl).toBe(
        'https://cdn.example.com/img.jpg',
      );
    });

    it('carries thumbnailUrl', () => {
      expect(buildReplyToSnapshot(mediaMsg, 'alice')!.thumbnailUrl).toBe(
        'https://cdn.example.com/img-thumb.jpg',
      );
    });
  });

  // ── UNSENT / deleted message ──────────────────────────────────────────────

  describe('UNSENT (deleted) message', () => {
    const unsent = {
      id: 'msg-3',
      senderId: 'alice',
      state: 'UNSENT',
      payload: {
        text: 'Secret content that must NOT leak',
        mediaType: 'image',
        mediaUrl: 'https://cdn.example.com/secret.jpg',
      },
      sender: { displayName: 'Alice', username: 'alice' },
    };

    it('has isUnsent=true', () => {
      expect(buildReplyToSnapshot(unsent, 'bob')!.isUnsent).toBe(true);
    });

    it('does NOT leak the original text', () => {
      expect(buildReplyToSnapshot(unsent, 'bob')!.text).toBe('');
    });

    it('does NOT leak mediaType', () => {
      expect(buildReplyToSnapshot(unsent, 'bob')!.mediaType).toBeNull();
    });

    it('does NOT leak mediaUrl', () => {
      expect(buildReplyToSnapshot(unsent, 'bob')!.mediaUrl).toBeNull();
    });

    it('does NOT leak share data', () => {
      const snap = buildReplyToSnapshot(unsent, 'bob')!;
      expect(snap.shareType).toBeNull();
      expect(snap.shareId).toBeNull();
      expect(snap.shareTitle).toBeNull();
    });

    it('still carries the sender name and message id', () => {
      const snap = buildReplyToSnapshot(unsent, 'bob')!;
      expect(snap.id).toBe('msg-3');
      expect(snap.senderName).toBe('Alice');
    });
  });

  // ── Shared entities ───────────────────────────────────────────────────────

  describe('shared entity payloads', () => {
    it('extracts a shared profile', () => {
      const msg = {
        id: 'msg-4',
        senderId: 'alice',
        state: null,
        payload: {
          profile: { id: 'u-1', displayName: 'Charlie', avatar: 'avatar.jpg' },
        },
        sender: { displayName: 'Alice', username: 'alice' },
      };
      const snap = buildReplyToSnapshot(msg, 'bob')!;
      expect(snap.shareType).toBe('profile');
      expect(snap.shareId).toBe('u-1');
      expect(snap.shareTitle).toBe('Charlie');
      expect(snap.shareAvatar).toBe('avatar.jpg');
    });

    it('extracts a shared community', () => {
      const msg = {
        id: 'msg-5',
        senderId: 'alice',
        state: null,
        payload: {
          community: { id: 'c-1', name: 'Dev Hub', avatarKey: 'comm.png', color: '#ff0' },
        },
        sender: { displayName: 'Alice', username: 'alice' },
      };
      const snap = buildReplyToSnapshot(msg, 'bob')!;
      expect(snap.shareType).toBe('community');
      expect(snap.shareTitle).toBe('Dev Hub');
      expect(snap.shareColor).toBe('#ff0');
    });

    it('extracts a group invite', () => {
      const msg = {
        id: 'msg-6',
        senderId: 'alice',
        state: null,
        payload: {
          inviteData: {
            type: 'group_invite',
            groupId: 'grp-1',
            groupName: 'Study Crew',
            groupAvatar: 'grp.png',
          },
        },
        sender: { displayName: 'Alice', username: 'alice' },
      };
      const snap = buildReplyToSnapshot(msg, 'bob')!;
      expect(snap.shareType).toBe('group_invite');
      expect(snap.shareId).toBe('grp-1');
      expect(snap.shareTitle).toBe('Study Crew');
    });

    it('returns null share fields when no entity is present', () => {
      const msg = {
        id: 'msg-7',
        senderId: 'alice',
        state: null,
        payload: { text: 'Hi' },
        sender: { displayName: 'Alice', username: 'alice' },
      };
      const snap = buildReplyToSnapshot(msg, 'bob')!;
      expect(snap.shareType).toBeNull();
      expect(snap.shareId).toBeNull();
    });
  });

  // ── viewerId edge cases ───────────────────────────────────────────────────

  describe('viewerId edge cases', () => {
    const msg = {
      id: 'msg-8',
      senderId: 'alice',
      state: null,
      payload: { text: 'hi' },
      sender: { displayName: 'Alice', username: 'alice' },
    };

    it('sets from="them" when viewerId is null', () => {
      expect(buildReplyToSnapshot(msg, null)!.from).toBe('them');
    });

    it('sets from="them" when viewerId is undefined', () => {
      expect(buildReplyToSnapshot(msg, undefined)!.from).toBe('them');
    });
  });

  // ── REPLY_TO_SELECT export ────────────────────────────────────────────────

  describe('REPLY_TO_SELECT', () => {
    it('includes the fields required by buildReplyToSnapshot', () => {
      expect(REPLY_TO_SELECT).toMatchObject({
        id: true,
        senderId: true,
        state: true,
        payload: true,
        sender: { select: { displayName: true, username: true } },
      });
    });
  });
});
