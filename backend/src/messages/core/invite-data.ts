/**
 * Attachments a message can carry in `payload.inviteData`: a shared profile,
 * community, post, activity or event, or a group invite.
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
