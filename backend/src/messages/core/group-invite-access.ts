import { randomBytes } from 'crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { GROUP_INVITE_TTL_MS, inviteString } from './invite-data';
import { payloadFields } from './message-payload';

/**
 * Whether an invite lets this person into this group, decided on the server.
 *
 * A group could be joined with nothing but its id: the 48-hour lifetime of an
 * invite card was a field the sender's client wrote and the recipient's client
 * displayed, so an expired card, a card anyone could forge (`inviteData` is
 * client-supplied) and the group's own address all opened the group the same
 * way. Now a non-member names the invite they came through, and it is checked
 * here:
 *
 * - `code`: an invite link (`GroupInviteLink`), shared outside Meetifyy.
 * - `messageId`: an invite card in a chat. The card is the credential: the
 *   viewer must be in the chat it was posted in, and its sender must still be
 *   in the group. Its lifetime runs from when the message was sent, whatever
 *   the card says about itself.
 * - neither: someone opened the group's address, which is not an invite.
 *   Shown like an expired invite (the product decision for addresses shared
 *   before invite links existed).
 */

/** How long an invite link lasts. */
export const INVITE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A link with at least this long left is handed out again rather than a new one made. */
export const INVITE_LINK_REUSE_MIN_MS = 24 * 60 * 60 * 1000;

/** How long after a declined request the same person may ask again. */
export const REQUEST_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export type InviteStatus = 'VALID' | 'EXPIRED' | 'REVOKED' | 'INVALID' | 'NONE';

export interface InviteRef {
  code?: string | null;
  messageId?: string | null;
}

export interface InviteAccess {
  status: InviteStatus;
  expiresAt: Date | null;
}

const NO_INVITE: InviteAccess = { status: 'NONE', expiresAt: null };
const INVALID: InviteAccess = { status: 'INVALID', expiresAt: null };

const CODE_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const INVITE_CODE_LENGTH = 12;
const CODE_PATTERN = new RegExp(`^[0-9A-Za-z]{${INVITE_CODE_LENGTH}}$`);

/**
 * A new link code: 12 base-62 characters (~71 bits) from the system CSPRNG.
 * Bytes at or above 248 are drawn again rather than folded in with `% 62`,
 * which would make the first eight characters likelier than the rest.
 */
export function newInviteCode(): string {
  let code = '';
  while (code.length < INVITE_CODE_LENGTH) {
    for (const byte of randomBytes(INVITE_CODE_LENGTH * 2)) {
      if (byte >= 248) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === INVITE_CODE_LENGTH) break;
    }
  }
  return code;
}

/** Whether a value could be a link code at all (checked before any lookup). */
export function isInviteCodeShape(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

/**
 * The invite named by `?code=&messageId=` on the preview route. Read as plain
 * query values rather than a DTO (the global pipe refuses unknown keys, and a
 * query string picks up cache-busters): anything that is not a short string
 * is dropped, and the resolver checks the shape of what is left.
 */
export function inviteRefFromQuery(
  code: unknown,
  messageId: unknown,
): InviteRef {
  const short = (v: unknown) =>
    typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : null;
  return { code: short(code), messageId: short(messageId) };
}

/** Epoch ms of a stored date value, or NaN. */
function timeOf(value: unknown): number {
  return typeof value === 'string' || typeof value === 'number'
    ? new Date(value).getTime()
    : NaN;
}

/** Whether `userId` is in the group now (a member who hid the chat still is). */
async function isInGroup(
  prisma: PrismaService,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const row = await prisma.conversationParticipant.findUnique({
    where: { userId_conversationId: { userId, conversationId: groupId } },
    select: { leftAt: true },
  });
  return Boolean(row && !row.leftAt);
}

async function linkAccess(
  prisma: PrismaService,
  groupId: string,
  code: string,
  now: Date,
): Promise<InviteAccess> {
  if (!isInviteCodeShape(code)) return INVALID;
  const link = await prisma.groupInviteLink.findUnique({
    where: { code },
    select: {
      conversationId: true,
      createdById: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!link || link.conversationId !== groupId) return INVALID;
  // Reset by an admin, or its creator is no longer in the group.
  if (link.revokedAt || !(await isInGroup(prisma, groupId, link.createdById))) {
    return { status: 'REVOKED', expiresAt: link.expiresAt };
  }
  if (link.expiresAt <= now) {
    return { status: 'EXPIRED', expiresAt: link.expiresAt };
  }
  return { status: 'VALID', expiresAt: link.expiresAt };
}

async function cardAccess(
  prisma: PrismaService,
  groupId: string,
  viewerId: string,
  messageId: string,
  resolveGroupId: (id: string) => Promise<string | null>,
  now: Date,
): Promise<InviteAccess> {
  if (messageId.length > 64) return INVALID;
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      conversationId: true,
      senderId: true,
      createdAt: true,
      deletedAt: true,
      state: true,
      payload: true,
    },
  });
  if (!message || message.deletedAt || message.state === 'UNSENT') {
    return INVALID;
  }
  const invite = payloadFields(payloadFields(message.payload).inviteData);
  const target =
    inviteString(invite, 'groupId') || inviteString(invite, 'conversationId');
  if (!target || (await resolveGroupId(target)) !== groupId) return INVALID;

  // Only someone the card was sent to can use it: a person who is in the chat
  // it was posted in. A card id copied out of someone else's chat is nothing.
  const [viewerInChat, senderInGroup] = await Promise.all([
    isInGroup(prisma, message.conversationId, viewerId),
    isInGroup(prisma, groupId, message.senderId),
  ]);
  if (!viewerInChat) return INVALID;

  // The server's clock decides. A card may carry an `expiresAt` of its own
  // (the field is the sender's to write); only an earlier one is honoured.
  const sentAt = message.createdAt.getTime();
  const claimed = timeOf(invite.expiresAt);
  const expiresAt = new Date(
    Number.isFinite(claimed)
      ? Math.min(claimed, sentAt + GROUP_INVITE_TTL_MS)
      : sentAt + GROUP_INVITE_TTL_MS,
  );
  if (!senderInGroup) return { status: 'REVOKED', expiresAt };
  if (expiresAt <= now) return { status: 'EXPIRED', expiresAt };
  return { status: 'VALID', expiresAt };
}

/**
 * The state of the invite `ref` names, for `viewerId` and the group whose
 * internal id is `groupId`. A link code wins when a caller sends both.
 */
export async function resolveInviteAccess(
  prisma: PrismaService,
  input: {
    groupId: string;
    viewerId: string;
    ref: InviteRef | null | undefined;
    resolveGroupId: (id: string) => Promise<string | null>;
    now?: Date;
  },
): Promise<InviteAccess> {
  const now = input.now ?? new Date();
  const code = input.ref?.code;
  const messageId = input.ref?.messageId;
  if (code) return linkAccess(prisma, input.groupId, code, now);
  if (messageId) {
    return cardAccess(
      prisma,
      input.groupId,
      input.viewerId,
      messageId,
      input.resolveGroupId,
      now,
    );
  }
  return NO_INVITE;
}

export type JoinState =
  | 'MEMBER'
  | 'CLOSED'
  | 'BLOCKED'
  | 'REQUESTED'
  | 'INVITE_EXPIRED'
  | 'INVITE_REVOKED'
  | 'INVITE_INVALID'
  | 'REJECTED'
  | 'APPROVAL_REQUIRED'
  | 'CAN_JOIN';

export interface JoinRequestState {
  status: string;
  decidedAt: Date | null;
}

/** When a declined person may ask again, or null when they may now. */
export function retryAfterDecline(
  request: JoinRequestState | null,
  now: Date,
): Date | null {
  if (!request || request.status !== 'REJECTED' || !request.decidedAt) {
    return null;
  }
  const retryAt = new Date(
    request.decidedAt.getTime() + REQUEST_RETRY_AFTER_MS,
  );
  return retryAt > now ? retryAt : null;
}

/**
 * The one state the preview shows, in this order: being in the group, the
 * group itself (ended, a block), a request already waiting, the invite, a
 * recent decline, and only then the group's "Who can join". A waiting request
 * stays visible after the invite it came through has expired; an expired or
 * revoked invite never offers Join or Request, whatever the setting says.
 */
export function joinStateFor(input: {
  isMember: boolean;
  isClosed: boolean;
  isBlocked: boolean;
  request: JoinRequestState | null;
  invite: InviteStatus;
  whoCanJoin: 'ANYONE' | 'APPROVAL';
  now: Date;
}): { joinState: JoinState; retryAt: Date | null } {
  const none = (joinState: JoinState) => ({ joinState, retryAt: null });
  if (input.isMember) return none('MEMBER');
  if (input.isClosed) return none('CLOSED');
  if (input.isBlocked) return none('BLOCKED');
  if (input.request?.status === 'PENDING') return none('REQUESTED');
  if (input.invite === 'EXPIRED' || input.invite === 'NONE') {
    return none('INVITE_EXPIRED');
  }
  if (input.invite === 'REVOKED') return none('INVITE_REVOKED');
  if (input.invite === 'INVALID') return none('INVITE_INVALID');
  const retryAt = retryAfterDecline(input.request, input.now);
  if (retryAt) return { joinState: 'REJECTED', retryAt };
  return none(
    input.whoCanJoin === 'APPROVAL' ? 'APPROVAL_REQUIRED' : 'CAN_JOIN',
  );
}

const INVITE_REFUSAL: Record<
  Exclude<InviteStatus, 'VALID'>,
  { code: string; message: string }
> = {
  NONE: {
    code: 'INVITE_REQUIRED',
    message: 'Ask a member of this group for an invite.',
  },
  EXPIRED: { code: 'INVITE_EXPIRED', message: 'This invite link has expired.' },
  REVOKED: {
    code: 'INVITE_REVOKED',
    message: 'This invite link is no longer valid.',
  },
  INVALID: {
    code: 'INVITE_INVALID',
    message: 'This invite link is not valid.',
  },
};

/** Throws unless the invite lets a non-member in. */
export function assertInviteUsable(access: InviteAccess): void {
  if (access.status === 'VALID') return;
  throw new ForbiddenException({
    statusCode: 403,
    ...INVITE_REFUSAL[access.status],
  });
}

/** A declined person asking again inside the wait. */
export function requestDeclinedError(retryAt: Date): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'REQUEST_DECLINED',
    message: 'An admin declined your request. You can ask again later.',
    retryAt: retryAt.toISOString(),
  });
}

/** Approving a request another admin has already declined. */
export function requestAlreadyDeclinedError(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'REQUEST_ALREADY_DECLINED',
    message: 'Another admin already declined this request.',
  });
}

/** How far back the admins' timeline lists requests to join. */
export const JOIN_ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** One of the people the preview shows, at most five. */
export interface GroupMemberPreview {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

/** GET /api/group-chats/:id/invite and GET /api/group-invites/:code. */
export interface GroupInvitePreview {
  id: string;
  publicId: string;
  internalId: string;
  name: string;
  avatar: string | null;
  avatarKey: string | null;
  description: string | null;
  memberCount: number;
  memberPreview: GroupMemberPreview[];
  whoCanJoin: 'ANYONE' | 'APPROVAL';
  visibility: string;
  status: string;
  isMember: boolean;
  myRole: string | null;
  hasPendingRequest: boolean;
  joinState: JoinState;
  /** When a declined person may ask again (joinState REJECTED). */
  retryAt: string | null;
  invite: { status: InviteStatus; expiresAt: string | null };
  requiresVerification: boolean;
}

/** One line of the admins' join-request timeline. */
export interface JoinRequestActivityItem {
  id: string;
  kind: 'JOIN_REQUESTED';
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedByUsername: string | null;
  user: GroupMemberPreview;
}
