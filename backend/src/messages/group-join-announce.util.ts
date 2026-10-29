import type { DomainEventService } from '../events/domain-event.service';
import type { PushDispatcherService } from '../push/push-dispatcher.service';
import { detach } from '../common/utils/detach.util';

/**
 * What a group controller announces when someone joins a group, asks to join
 * it, or has their request answered. All of it runs after the reply.
 *
 * The group-chats controller and the older messages controller each carried
 * their own copy, and they had drifted: a join through the older route told
 * no one (no `group:member_added`, so other members' rosters and room
 * subscriptions lagged), an approval named only one of the group's ids and no
 * time of joining (the new member's sockets joined one of the group's two
 * rooms, and their clients could not order the event), the approved person's
 * inbox did not learn of the group until it refetched, and a new request
 * reached no one: no admin saw it until they happened to reopen the group.
 */
export interface GroupAnnouncer {
  events: DomainEventService;
  push?: PushDispatcherService;
  participantIds(conversationId: string): Promise<string[]>;
  /** The group's owner and admins (who review requests). */
  reviewerIds(internalId: string): Promise<string[]>;
  userHandle(userId: string): Promise<string>;
  /** Posts a system line to everyone in the group, best effort. */
  systemLine(
    internalId: string,
    actorId: string,
    text: string,
  ): Promise<unknown>;
}

export interface GroupIdentity {
  conversationId: string;
  publicId: string;
  internalId: string;
}

type Joined = GroupIdentity & { membershipChangedAt: string | null };

function afterReply(label: string, work: () => Promise<unknown>): void {
  setImmediate(() => detach(label, work));
}

function membershipPayload(group: Joined, userId: string) {
  return {
    conversationId: group.publicId,
    publicId: group.publicId,
    internalId: group.internalId,
    userId,
    membershipChangedAt: group.membershipChangedAt,
  };
}

/**
 * The ids an admin-only or requester-only event carries.
 *
 * Never `conversationId`: the gateway sends an event that has no target user
 * to the conversation's room, i.e. to every member, when its data names a
 * conversation. With only these two keys a missing target is dropped instead,
 * so a request can never reach the group by mistake.
 */
function groupIds(group: { publicId?: string; internalId: string }) {
  return {
    ...(group.publicId ? { publicId: group.publicId } : {}),
    internalId: group.internalId,
  };
}

/**
 * The group's requests changed: each reviewer's devices refetch the list and
 * the timeline's request lines (they hold names and photos, so the event
 * carries only the group). The owner and admins only.
 */
function requestsChanged(
  events: DomainEventService,
  reviewerIds: string[],
  group: { publicId?: string; internalId: string },
): void {
  if (reviewerIds.length === 0) return;
  void events.emit('group:join_requests', groupIds(group), reviewerIds);
}

/**
 * The requester's own request was answered: their devices refresh the group
 * preview ("Request pending" becomes the group, or "Request declined").
 * Only to them, and without who answered.
 */
function requestDecided(
  events: DomainEventService,
  requesterId: string,
  group: { publicId?: string; internalId: string },
  status: 'APPROVED' | 'REJECTED',
): void {
  void events.emit(
    'group:join_request_decided',
    { ...groupIds(group), status },
    [requesterId],
  );
}

/** Someone joined (an open group, or an invite). */
export function announceJoined(
  a: GroupAnnouncer,
  group: Joined,
  userId: string,
): void {
  afterReply('group join fan-out', async () => {
    const participantIds = await a.participantIds(group.internalId);
    // The membership events first: the joiner needs conversation:updated to
    // pull the group into their list, the members need member_added.
    void a.events.emit(
      'group:member_added',
      membershipPayload(group, userId),
      participantIds,
    );
    void a.events.emit(
      'conversation:updated',
      { conversationId: group.publicId },
      participantIds,
    );
    const handle = await a.userHandle(userId);
    await a.systemLine(group.internalId, userId, `${handle} joined the group`);
  });
}

/** A request the reviewers have not seen: their list, and a push each. */
export function announceJoinRequested(
  a: GroupAnnouncer,
  group: GroupIdentity,
  requesterId: string,
): void {
  afterReply('group join request fan-out', async () => {
    const reviewers = await a.reviewerIds(group.internalId);
    requestsChanged(a.events, reviewers, group);
    for (const recipientId of reviewers) {
      a.push?.enqueueForGroupJoinRequest({
        recipientId,
        conversationId: group.internalId,
        requesterId,
      });
    }
  });
}

/** A request was approved: the new member, the members, the reviewers. */
export function announceRequestApproved(
  a: GroupAnnouncer,
  group: Joined,
  approverId: string,
  targetUserId: string,
): void {
  afterReply('group request approved fan-out', async () => {
    const [memberIds, reviewers] = await Promise.all([
      a.participantIds(group.internalId),
      a.reviewerIds(group.internalId),
    ]);
    void a.events.emit(
      'group:member_added',
      membershipPayload(group, targetUserId),
      [...new Set([targetUserId, ...memberIds])],
    );
    // The new member's inbox shows the group now, not at its next refetch.
    void a.events.emit(
      'conversation:updated',
      { conversationId: group.publicId },
      [targetUserId],
    );
    requestsChanged(a.events, reviewers, group);
    requestDecided(a.events, targetUserId, group, 'APPROVED');
    // The requester's phone, which may be in a pocket since they asked.
    a.push?.enqueueForGroupJoinApproved({
      recipientId: targetUserId,
      conversationId: group.internalId,
      approvedAt: group.membershipChangedAt ?? new Date().toISOString(),
    });
    const [actor, target] = await Promise.all([
      a.userHandle(approverId),
      a.userHandle(targetUserId),
    ]);
    await a.systemLine(
      group.internalId,
      approverId,
      `${actor} approved ${target}'s request to join`,
    );
  });
}

/**
 * A request was declined: the reviewers' lists, and the requester's preview.
 * Nothing reaches the group, and no push: a decline is not news to wake
 * someone for.
 */
export function announceRequestDeclined(
  a: GroupAnnouncer,
  group: { publicId?: string; internalId: string },
  requesterId: string,
): void {
  afterReply('group request declined fan-out', async () => {
    requestsChanged(a.events, await a.reviewerIds(group.internalId), group);
    requestDecided(a.events, requesterId, group, 'REJECTED');
  });
}
