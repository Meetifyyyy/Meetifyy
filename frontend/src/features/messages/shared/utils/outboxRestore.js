/**
 * Turns persisted outbox entries back into chat bubbles.
 *
 * After a cold start the query cache is empty, so a first history page cannot
 * fold back unsent messages from it. The outbox in IndexedDB still holds them
 * (queued ones until delivered, failed ones for tap-to-retry), and this is
 * how they reappear in the chat they belong to.
 */

/** Builds the optimistic bubble for one outbox entry. */
export function outboxEntryToMessage(entry, currentUser) {
  const p = entry?.payload || {};
  const failed = !!entry.failed;
  const created = Number.isFinite(entry.createdAt) ? entry.createdAt : Date.parse(entry.createdAt);
  return {
    id: entry.clientId,
    tempId: entry.clientId,
    clientId: entry.clientId,
    conversationId: entry.conversationId,
    senderId: currentUser?.id || entry.userId || 'me',
    sender: currentUser || { id: entry.userId || 'me' },
    from: 'me',
    text: p.text || '',
    payload: {
      text: p.text || '',
      mediaUrl: p.mediaUrl ?? null,
      thumbnailUrl: p.thumbnailUrl ?? null,
      mediaType: p.mediaType ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      duration: p.duration ?? null,
      mentions: p.mentions,
      inviteData: p.inviteData,
      clientId: entry.clientId,
      tempId: entry.clientId,
    },
    mediaType: p.mediaType ?? null,
    replyToId: p.replyToId ?? null,
    status: failed ? 'failed' : 'sending',
    queued: !failed,
    isOptimistic: true,
    createdAt: new Date(Number.isFinite(created) ? created : Date.now()).toISOString(),
  };
}

/**
 * The outbox entries for this conversation (any of its aliases) that the
 * given messages do not already contain, as bubbles.
 */
export function restorableOutboxMessages(entries, conversationIds, existingMessages, currentUser) {
  const ids = new Set((conversationIds || []).filter(Boolean).map(String));
  const known = new Set(
    (existingMessages || []).flatMap((m) => (m ? [m.id, m.clientId, m.tempId] : [])).filter(Boolean).map(String),
  );
  return (entries || [])
    .filter((e) => e && e.clientId && ids.has(String(e.conversationId)) && !known.has(String(e.clientId)))
    .map((e) => outboxEntryToMessage(e, currentUser));
}
