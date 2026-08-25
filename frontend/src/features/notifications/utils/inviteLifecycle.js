/**
 * The single place that decides what state an activity invite is in.
 *
 * An invite is a record, not a transient prompt: once it has been answered (or
 * overtaken by the activity being cancelled or ending) the row stays in the
 * Notifications page showing what happened. The backend writes the answer to
 * `metadata.lifecycleStatus` on the very same notification row, so that value
 * is authoritative whenever it is present; the activity's own status is only a
 * fallback for rows created before this field existed.
 */

export const INVITE_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
};

const TERMINAL = new Set([
  INVITE_STATUS.ACCEPTED,
  INVITE_STATUS.DECLINED,
  INVITE_STATUS.CANCELLED,
  INVITE_STATUS.EXPIRED,
]);

export function isTerminalInviteStatus(status) {
  return TERMINAL.has(status);
}

/**
 * Resolves the status of an invite row.
 *
 * The recipient's own answer always wins over the activity's status — someone
 * who accepted should keep seeing "Accepted" after the activity later ends,
 * not have their own action overwritten by the activity's lifecycle.
 */
export function resolveInviteStatus(inv) {
  const explicit = (inv?.lifecycleStatus || inv?.inviteStatus || '').toUpperCase();
  if (explicit === 'ACCEPTED' || explicit === 'DECLINED') return explicit;
  if (explicit && TERMINAL.has(explicit)) return explicit;

  // Legacy rows carry no lifecycle field; derive the best available answer
  // from the invitation record and the activity itself.
  const invitationStatus = (inv?.status || '').toUpperCase();
  if (TERMINAL.has(invitationStatus)) return invitationStatus;

  const activityStatus = (inv?.activityStatus || '').toUpperCase();
  if (activityStatus === 'CANCELLED') return INVITE_STATUS.CANCELLED;
  if (activityStatus === 'ENDED' || activityStatus === 'COMPLETED') return INVITE_STATUS.EXPIRED;

  // An invite stops being answerable when the activity STARTS, not when it
  // finishes — the join endpoint refuses a started activity, so anything later
  // than the start time is already expired in practice. The server sweep sets
  // this explicitly; deriving it here as well means the row reads correctly in
  // the seconds before that sweep runs, and for rows written before the
  // lifecycle field existed.
  const start = inv?.startDate ? new Date(inv.startDate) : null;
  if (start && start.getTime() <= Date.now()) return INVITE_STATUS.EXPIRED;

  return INVITE_STATUS.PENDING;
}

export const INVITE_STATUS_LABEL = {
  [INVITE_STATUS.PENDING]: 'Pending',
  [INVITE_STATUS.ACCEPTED]: 'Accepted',
  [INVITE_STATUS.DECLINED]: 'Declined',
  [INVITE_STATUS.CANCELLED]: 'Cancelled',
  [INVITE_STATUS.EXPIRED]: 'Expired',
};

/**
 * Normalises a notification row into the shape InvitationItem renders, so the
 * Invitations tab can be driven by the notification feed (which keeps answered
 * invites) rather than by the pending-only invitations endpoint.
 */
export function inviteFromNotification(notif) {
  const meta = notif?.metadata || {};
  return {
    id: meta.invitationId || notif.id,
    notificationId: notif.id,
    activityId: meta.activityId || notif.entityId,
    title: meta.title,
    location: meta.location,
    startDate: meta.startDate,
    endDate: meta.endDate,
    coverImage: meta.coverImage,
    coverColor: meta.coverColor,
    hostId: meta.hostId || notif.actor?.id,
    hostName: meta.hostName || notif.actor?.displayName || notif.actor?.username,
    hostUsername: meta.hostUsername || notif.actor?.username,
    hostAvatar: meta.hostAvatar || notif.actor?.avatar,
    lifecycleStatus: meta.lifecycleStatus,
    createdAt: notif.createdAt,
    readAt: notif.readAt,
  };
}

/**
 * Patches the cached notification feed in place so an invite's status changes
 * without a refetch and without ever dropping the row.
 *
 * Matching is by invitation id first, activity id second — a realtime
 * `notification:updated` event carries the notification itself, while an
 * optimistic local update only knows the invitation it just answered.
 */
export function patchInviteNotification(queryClient, { notificationId, invitationId, activityId, status, metadata }) {
  // Every notification cache entry: the main feed and the type-filtered
  // Invitations feed both hold this row, and patching only one would let the
  // two tabs disagree about the same invite. Entries that are not a paged feed
  // (the unread count) fall through the guard below untouched.
  queryClient.setQueriesData({ queryKey: ['notifications'] }, (old) => {
    if (!old?.pages) return old;
    let touched = false;

    const pages = old.pages.map((page) => {
      if (!Array.isArray(page?.data)) return page;
      const data = page.data.map((notif) => {
        if (notif.type !== 'ACTIVITY_INVITE') return notif;
        const meta = notif.metadata || {};
        const matches =
          (notificationId && notif.id === notificationId) ||
          (invitationId && meta.invitationId === invitationId) ||
          (activityId && (meta.activityId || notif.entityId) === activityId);
        if (!matches) return notif;

        // Out-of-order realtime: two lifecycle events for the same invite can
        // arrive reversed (separate sockets, a reconnect replay, two tabs).
        // Each carries the instant the server stamped it, so an event older
        // than what the cache already holds is dropped rather than allowed to
        // regress the row to a superseded status.
        const incomingAt = metadata?.lifecycleUpdatedAt;
        const currentAt = meta.lifecycleUpdatedAt;
        if (incomingAt && currentAt && new Date(incomingAt) < new Date(currentAt)) {
          return notif;
        }

        touched = true;
        return {
          ...notif,
          metadata: { ...meta, ...(metadata || {}), ...(status ? { lifecycleStatus: status } : {}) },
        };
      });
      return { ...page, data };
    });

    return touched ? { ...old, pages } : old;
  });
}
