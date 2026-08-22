/**
 * One resolver for every reply preview in the app.
 *
 * The reply UI previously rendered `replyTo.text` and nothing else, so quoting an
 * image, a voice note, a shared profile or a group invite produced the sender's
 * name above an empty space. Two places had that bug independently — the bubble
 * quote and the composer bar — so the logic lives here and both render from it.
 *
 * It accepts BOTH shapes a quoted message arrives in:
 *   • the full message object, used while composing (the user just clicked reply)
 *   • the trimmed `replyTo` snapshot the server sends with a stored message
 * so a preview looks identical before and after the reply is sent.
 *
 * The contract is that it ALWAYS returns something renderable. An unrecognised
 * message type falls back to a generic label rather than an empty string, which
 * is what keeps a future message type from silently reintroducing a blank quote.
 *
 * @typedef {{
 *   kind: string,
 *   text: string,
 *   icon: string|null,
 *   thumbnailKey: string|null,
 *   isUnavailable: boolean,
 * }} ReplyPreview
 */

/** Longest quoted text shown before ellipsis. */
const MAX_TEXT = 120;

function truncate(value) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s;
}

/** First non-empty string among the candidates. */
function firstText(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

/**
 * Finds a shared entity on either shape: the server snapshot flattens it to
 * `shareType`/`shareTitle`, while a live message still holds the whole object.
 */
function resolveShare(msg) {
  if (msg.shareType) {
    return { type: msg.shareType, title: firstText(msg.shareTitle) };
  }

  const payload = msg.payload || {};
  const invite = payload.inviteData || msg.inviteData || {};
  const pairs = [
    ['profile', payload.profile || invite.profile],
    ['community', payload.community || invite.community],
    ['post', payload.post || invite.post],
    ['activity', payload.activity || invite.activity],
    ['event', payload.event || invite.event],
  ];
  for (const [type, entity] of pairs) {
    if (entity && typeof entity === 'object') {
      return {
        type,
        title: firstText(entity.name, entity.title, entity.displayName, entity.username),
      };
    }
  }
  if (typeof invite.type === 'string' && invite.type) {
    const type = invite.type === 'group_invite' ? 'group_invite' : invite.type;
    return { type, title: firstText(invite.groupName, invite.name) };
  }
  return null;
}

/** Normalises the many ways a media type is recorded across message shapes. */
function resolveMediaKind(msg) {
  const payload = msg.payload || {};
  const raw = String(
    msg.mediaType || payload.mediaType || msg.type || payload.type || '',
  ).toLowerCase();

  if (!raw) return null;
  if (raw === 'voice' || raw === 'audio') return 'voice';
  if (raw === 'video') return 'video';
  if (raw === 'gif') return 'gif';
  if (raw === 'sticker') return 'sticker';
  if (raw === 'image' || raw === 'photo') return 'image';
  if (raw === 'file' || raw === 'document') return 'file';
  return null;
}

/** Labels shown when a quoted message has no text of its own. */
const KIND_LABEL = {
  image: 'Photo',
  video: 'Video',
  voice: 'Voice message',
  gif: 'GIF',
  sticker: 'Sticker',
  file: 'File',
  profile: 'Shared profile',
  community: 'Shared community',
  post: 'Shared post',
  activity: 'Shared activity',
  event: 'Shared event',
  group_invite: 'Group invite',
  link: 'Link',
  unavailable: 'Message unavailable',
  deleted: 'This message was deleted',
  unknown: 'Message',
};

/**
 * @param {object|null|undefined} msg full message or server `replyTo` snapshot
 * @returns {ReplyPreview}
 */
export function resolveReplyPreview(msg) {
  // The quoted message could not be loaded (deleted upstream, failed fetch, or a
  // reply to something outside the fetched page). Never render an empty quote.
  if (!msg || typeof msg !== 'object') {
    return { kind: 'unavailable', text: KIND_LABEL.unavailable, icon: 'alert', thumbnailKey: null, isUnavailable: true };
  }

  const payload = msg.payload || {};

  const isDeleted =
    msg.isUnsent === true ||
    msg.state === 'UNSENT' ||
    msg.deleted === true ||
    msg.isDeleted === true;
  if (isDeleted) {
    return { kind: 'deleted', text: KIND_LABEL.deleted, icon: 'ban', thumbnailKey: null, isUnavailable: true };
  }

  const bodyText = truncate(firstText(msg.text, payload.text, msg.content));

  // Shared entities outrank media: a shared post with an image should read as the
  // post, not as a photo.
  const share = resolveShare(msg);
  if (share) {
    const label = KIND_LABEL[share.type] || KIND_LABEL.unknown;
    return {
      kind: share.type,
      // Prefer the entity's own name; fall back to the type so it is never blank.
      text: share.title || label,
      icon: share.type,
      thumbnailKey: null,
      isUnavailable: false,
    };
  }

  const mediaKind = resolveMediaKind(msg);
  if (mediaKind) {
    const thumbnailKey =
      mediaKind === 'image' || mediaKind === 'video' || mediaKind === 'gif' || mediaKind === 'sticker'
        ? firstText(payload.thumbnailUrl, msg.thumbnailUrl, payload.mediaUrl, msg.mediaUrl) || null
        : null;
    return {
      // A caption, when present, is more useful than a generic "Photo".
      kind: mediaKind,
      text: bodyText || KIND_LABEL[mediaKind],
      icon: mediaKind,
      thumbnailKey,
      isUnavailable: false,
    };
  }

  // Media present but untyped — still better than a blank quote.
  const anyMedia = firstText(msg.mediaUrl, payload.mediaUrl);
  if (anyMedia) {
    return {
      kind: 'image',
      text: bodyText || KIND_LABEL.image,
      icon: 'image',
      thumbnailKey: firstText(payload.thumbnailUrl, anyMedia) || null,
      isUnavailable: false,
    };
  }

  if (bodyText) {
    const isBareLink = /^https?:\/\/\S+$/i.test(bodyText);
    return {
      kind: isBareLink ? 'link' : 'text',
      text: bodyText,
      icon: isBareLink ? 'link' : null,
      thumbnailKey: null,
      isUnavailable: false,
    };
  }

  // Nothing recognised. A generic label keeps the quote from collapsing, which is
  // the failure this module exists to prevent.
  return { kind: 'unknown', text: KIND_LABEL.unknown, icon: null, thumbnailKey: null, isUnavailable: false };
}

export { KIND_LABEL };
