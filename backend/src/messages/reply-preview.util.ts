/**
 * Builds the snapshot of a quoted message that is sent to clients as `replyTo`.
 *
 * This used to return only `{ id, text, senderName, from }`, so replying to
 * anything without text — an image, a voice note, a shared profile or community,
 * a group invite — produced a quote the client had nothing to render, and the
 * reply bubble showed the sender's name above an empty space. The client cannot
 * fix that on its own: the information had already been discarded server-side.
 *
 * The snapshot therefore carries enough to describe the quoted message, and no
 * more: identifying fields plus a short title for shared entities. Full entity
 * payloads are deliberately NOT echoed — a quote only needs a label, and
 * embedding them would duplicate large objects into every reply.
 *
 * Rendering decisions belong to the client, which owns one resolver for both the
 * composer bar and the bubble quote; this only stops the data being thrown away.
 */

export type ReplyToSnapshot = {
  id: string;
  senderName: string;
  from: 'me' | 'them';
  text: string;
  /** 'image' | 'video' | 'audio' | 'file' | null — as stored on the message. */
  mediaType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  /** Semantic kind of any shared entity, e.g. 'profile' | 'community' | 'post'. */
  shareType: string | null;
  /**
   * The entity's own id. Lets the client look the entity up in live app state and
   * render its CURRENT avatar rather than the one captured when it was shared —
   * a snapshot goes stale the moment that user or community changes their picture.
   */
  shareId: string | null;
  /** Human-readable name of the shared entity, for the quote label. */
  shareTitle: string | null;
  /**
   * The shared entity's own avatar, so a quoted profile or community shows its
   * real picture rather than a placeholder. A reference only — the client
   * resolves it through the media layer like any other avatar.
   */
  shareAvatar: string | null;
  /**
   * A community's brand colour. Communities without a picture are shown
   * everywhere else in the app as a coloured circle bearing their initial, so the
   * quote needs the colour to match rather than fall back to a generic icon.
   */
  shareColor: string | null;
  /** True when the original was unsent/deleted, so the quote can say so. */
  isUnsent: boolean;
};

type ReplyToRow = {
  id: string;
  senderId: string;
  state?: string | null;
  payload?: any;
  sender?: { displayName?: string | null; username?: string | null } | null;
};

/** Pulls a display name out of whichever shared-entity shape is present. */
function describeShare(payload: any): {
  shareType: string | null;
  shareId: string | null;
  shareTitle: string | null;
  shareAvatar: string | null;
  shareColor: string | null;
} {
  const invite = payload?.inviteData || {};
  const candidates: Array<[string, any]> = [
    ['profile', payload?.profile || invite.profile],
    ['community', payload?.community || invite.community],
    ['post', payload?.post || invite.post],
    ['activity', payload?.activity || invite.activity],
    ['event', payload?.event || invite.event],
  ];

  for (const [type, entity] of candidates) {
    if (entity && typeof entity === 'object') {
      const title =
        entity.name ||
        entity.title ||
        entity.displayName ||
        entity.username ||
        null;
      // Communities store the image under avatarKey, users under avatar; posts
      // and activities may use a cover instead.
      const avatar =
        entity.avatarKey ||
        entity.avatar ||
        entity.avatarUrl ||
        entity.coverKey ||
        entity.image ||
        null;
      return {
        shareType: type,
        shareId: typeof entity.id === 'string' && entity.id ? entity.id : null,
        shareTitle: typeof title === 'string' ? title : null,
        shareAvatar: typeof avatar === 'string' && avatar.trim() ? avatar : null,
        shareColor: typeof entity.color === 'string' && entity.color.trim() ? entity.color : null,
      };
    }
  }

  // Group invites carry no nested entity, only a type discriminator.
  const inviteType = typeof invite.type === 'string' ? invite.type : null;
  if (inviteType) {
    const inviteAvatar = invite.groupAvatar || invite.avatarKey || invite.avatar || null;
    const inviteId = invite.groupId || invite.conversationId || invite.communityId || null;
    return {
      shareType: inviteType === 'group_invite' ? 'group_invite' : inviteType,
      shareId: typeof inviteId === 'string' && inviteId ? inviteId : null,
      shareTitle: typeof invite.groupName === 'string' ? invite.groupName : null,
      shareAvatar: typeof inviteAvatar === 'string' && inviteAvatar.trim() ? inviteAvatar : null,
      shareColor: typeof invite.color === 'string' && invite.color.trim() ? invite.color : null,
    };
  }

  return { shareType: null, shareId: null, shareTitle: null, shareAvatar: null, shareColor: null };
}

/**
 * @param replyTo   the quoted message row (needs id, senderId, state, payload, sender)
 * @param viewerId  the id of the user this response is being built for
 */
export function buildReplyToSnapshot(
  replyTo: ReplyToRow | null | undefined,
  viewerId: string | null | undefined,
): ReplyToSnapshot | null {
  if (!replyTo) return null;

  const payload = replyTo.payload || {};
  const isUnsent = replyTo.state === 'UNSENT';
  const { shareType, shareId, shareTitle, shareAvatar, shareColor } = isUnsent
    ? { shareType: null, shareId: null, shareTitle: null, shareAvatar: null, shareColor: null }
    : describeShare(payload);

  return {
    id: replyTo.id,
    senderName: replyTo.sender?.displayName || replyTo.sender?.username || '',
    from: viewerId && replyTo.senderId === viewerId ? 'me' : 'them',
    // An unsent original must not leak its former contents through the quote.
    text: isUnsent ? '' : (typeof payload.text === 'string' ? payload.text : ''),
    mediaType: isUnsent ? null : (payload.mediaType || null),
    mediaUrl: isUnsent ? null : (payload.mediaUrl || null),
    thumbnailUrl: isUnsent ? null : (payload.thumbnailUrl || null),
    shareType,
    shareId,
    shareTitle,
    shareAvatar,
    shareColor,
    isUnsent,
  };
}

/** Select clause for any query whose result is passed to buildReplyToSnapshot. */
export const REPLY_TO_SELECT = {
  id: true,
  senderId: true,
  state: true,
  payload: true,
  sender: { select: { displayName: true, username: true } },
} as const;
