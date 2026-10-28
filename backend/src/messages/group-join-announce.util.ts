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
 * The group's pending requests changed: each reviewer's devices refetch the
 * list (it holds names and photos, so the event carries only the group).
 */
function requestsChanged(
  events: DomainEventService,
  reviewerIds: string[],
  group: Partial<GroupIdentity> & { internalId: string },
): void {
  if (reviewerIds.length === 0) return;
  const ids = {
    ...(group.conversationId ? { conversationId: group.conversationId } : {}),
    ...(group.publicId ? { publicId: group.publicId } : {}),
    internalId: group.internalId,
  };
  void events.emit('group:join_requests', ids, reviewerIds);
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

/** A request was declined: only the other reviewers' lists change. */
export function announceRequestDeclined(
  a: GroupAnnouncer,
  internalId: string,
): void {
  afterReply('group request declined fan-out', async () => {
    requestsChanged(a.events, await a.reviewerIds(internalId), { internalId });
  });
}
