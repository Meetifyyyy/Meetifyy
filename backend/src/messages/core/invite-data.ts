import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';

/**
 * Attachments a message can carry in `payload.inviteData`: a shared profile,
 * community, post, activity, event or confession, or a group invite.
 *
 * It arrives from the client (SendMessageDto only checks it is an object) and
 * is stored as JSON, so no field is guaranteed; code that reads one narrows it.
 */
export type InviteData = Record<string, unknown>;

/** How long a group invite stays usable when it names no expiry of its own. */
export const GROUP_INVITE_TTL_MS = 48 * 60 * 60 * 1000;

/** A group invite, as opposed to a shared entity: it grants entry to a chat. */
function isGroupInvite(invite: InviteData): boolean {
  return Boolean(
    invite.type === 'group_invite' || invite.groupId || invite.conversationId,
  );
}

/** Epoch ms for a stored date value, or NaN for anything that is not one. */
function timeOf(value: unknown): number {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    value instanceof Date
    ? new Date(value).getTime()
    : NaN;
}

/**
 * The invite with its expiry resolved: `expiresAt` defaults to 48 hours after
 * `createdAt` (the message's creation, or now when writing), and `isExpired` is
 * recomputed every time so a stored invite reports its current state without
 * being rewritten. Anything that is not a group invite is returned unchanged,
 * and a missing invite is null.
 *
 * This was written out six times across the send and read paths of both
 * messaging services; one copy drifting would have given the same invite two
 * different expiries depending on which endpoint served it.
 */
export function withInviteExpiry(
  inviteData: unknown,
  createdAt?: Date | string | null,
): unknown {
  if (!inviteData) return null;
  if (typeof inviteData !== 'object') return inviteData;
  const invite = inviteData as InviteData;
  if (!isGroupInvite(invite)) return invite;

  const createdAtMs = createdAt ? new Date(createdAt).getTime() : Date.now();
  const expiresAt =
    invite.expiresAt ||
    new Date(createdAtMs + GROUP_INVITE_TTL_MS).toISOString();
  return {
    ...invite,
    expiresAt,
    isExpired: timeOf(expiresAt) <= Date.now(),
  };
}

/** A string field of an invite (e.g. `type`, `groupName`), or undefined. */
export function inviteString(invite: unknown, key: string): string | undefined {
  if (typeof invite !== 'object' || invite === null) return undefined;
  const value = (invite as InviteData)[key];
  return typeof value === 'string' ? value : undefined;
}

/** `inviteData.type` of a confession shared into a chat. */
export const CONFESSION_SHARE = 'confessionShare';

/**
 * The invite as it may be stored. Every kind passes through unchanged except
 * a shared confession, which is cut down to its id.
 *
 * A confession is anonymous and can be deleted, hidden or removed at any time,
 * and it is visible only on its own campus. A copy of its text stored in a
 * message would outlive all three: it would stay readable after a takedown
 * and reach a recipient on another campus. So the message holds only the id,
 * and each client asks `GET /api/confessions/:id`, which applies the
 * confession's own rules for that viewer at that moment. Whatever else a
 * client puts beside the id is dropped here, before anything is written.
 */
export function storableInviteData(invite: unknown): unknown {
  if (inviteString(invite, 'type') !== CONFESSION_SHARE) return invite;
  const confessionId = inviteString(invite, 'confessionId');
  if (!confessionId || !isUUID(confessionId)) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'invalid_shared_confession',
      message: 'That confession can’t be shared.',
    });
  }
  return { type: CONFESSION_SHARE, confessionId };
}

const SHARE_SUMMARY: Record<string, string> = {
  postShare: 'Shared a post',
  profileShare: 'Shared a profile',
  communityShare: 'Shared a community',
  activityShare: 'Shared an activity',
  [CONFESSION_SHARE]: 'Shared a confession',
};

/**
 * What a chat list shows for a message that is only an attachment: the kind
 * of thing shared, or the group an invite is for. Never the shared content,
 * which for a confession must not be copied anywhere (see above). Null when
 * the invite is not one of these.
 */
export function inviteSummary(invite: unknown): string | null {
  const type = inviteString(invite, 'type');
  if (type && SHARE_SUMMARY[type]) return SHARE_SUMMARY[type];
  const groupName = inviteString(invite, 'groupName');
  return groupName ? `Group invite: ${groupName}` : null;
}
