export function matchesConversationId(c, targetId) {
  if (!c || !targetId) return false;
  const targetStr = String(targetId).trim().toLowerCase();
  if (!targetStr) return false;

  const cleanTarget = targetStr.replace(/^(act_)+/, '').replace(/^(c_)+/, '');

  const candidates = [
    c.id,
    c.publicId,
    c.internalId,
    c.activityId,
    c.username,
    c.otherUser?.username,
    c.otherUser?.id,
  ].filter(Boolean).map(val => String(val).trim().toLowerCase());

  if (candidates.includes(targetStr)) return true;

  for (const cand of candidates) {
    const cleanCand = cand.replace(/^(act_)+/, '').replace(/^(c_)+/, '');
    if (cleanCand && cleanCand === cleanTarget) return true;
  }

  const participants = c.participants || c.members || [];
  for (const p of participants) {
    if (!p) continue;
    const pUserId = p.userId != null ? String(p.userId).trim().toLowerCase() : null;
    const pId = p.id != null ? String(p.id).trim().toLowerCase() : null;
    const pUsername = p.username != null ? String(p.username).trim().toLowerCase() : null;

    if (pUserId === targetStr || pId === targetStr || pUsername === targetStr) {
      return true;
    }
  }

  return false;
}

export function getConversationAliases(c) {
  if (!c) return [];
  const set = new Set();
  [
    c.id,
    c.publicId,
    c.internalId,
    c.activityId,
    c.username,
    c.otherUser?.username,
    c.otherUser?.id,
  ].forEach(val => {
    if (val != null) {
      const s = String(val).trim();
      if (s) {
        set.add(s);
        const clean = s.replace(/^(act_)+/, '').replace(/^(c_)+/, '');
        if (clean) set.add(clean);
      }
    }
  });

  // Participant user-IDs are intentionally excluded from aliases.
  // Including them caused messages to be written to cache keys that matched
  // unrelated conversations sharing those participants.

  return Array.from(set);
}

// Shared status rank — higher = further along the delivery pipeline.
// 'failed' is -1 so it is ALWAYS preserved over any incoming server status.
export const STATUS_RANK = { failed: -1, sending: 0, sent: 1, delivered: 2, read: 3, seen: 3 };

export function appendMessageToCache(queryClient, activeChatId, message) {
  if (!queryClient || !activeChatId || !message) return;

  queryClient.setQueryData(['messages', activeChatId], (old) => {
    if (!old || !old.pages || old.pages.length === 0) {
      return {
        pages: [{ messages: [message], nextCursor: undefined }],
        pageParams: [undefined],
      };
    }

    const matchesMsg = (m) =>
      (message.id && m.id === message.id) ||
      (message.clientId && (m.clientId === message.clientId || m.tempId === message.clientId || m.id === message.clientId)) ||
      (message.tempId && (m.tempId === message.tempId || m.clientId === message.tempId || m.id === message.tempId)) ||
      (message.id && (m.tempId === message.id || m.clientId === message.id));

    // Check if message exists anywhere across all pages
    let found = false;
    const newPages = old.pages.map((page) => {
      const msgs = page.messages || [];
      const idx = msgs.findIndex(matchesMsg);
      if (idx !== -1) {
        found = true;
        const updatedMsgs = [...msgs];
        const existing = msgs[idx];
        const stableClientId = existing.clientId || message.clientId || existing.tempId || message.tempId;
        const stableTempId = existing.tempId || message.tempId || existing.clientId || message.clientId;

        // Never downgrade status. A server broadcast carrying 'sent' must not
        // overwrite an existing 'failed' (-1) or higher-ranked status.
        // Unknown/undefined status defaults to 0 (between 'failed'=-1 and 'sent'=1),
        // so any known server status can always upgrade it.
        const existingRank = STATUS_RANK[existing.status] ?? 0;
        const incomingRank = STATUS_RANK[message.status] ?? 0;
        const resolvedStatus = existingRank > incomingRank ? existing.status : (message.status || existing.status);

        const isUnsent = existing.state === 'UNSENT' || existing.isUnsent || message.state === 'UNSENT' || message.isUnsent || existing.text === 'This message was unsent' || message.text === 'This message was unsent';

        updatedMsgs[idx] = {
          ...existing,
          ...message,
          clientId: stableClientId,
          tempId: stableTempId,
          status: resolvedStatus,
          ...(isUnsent ? {
            state: 'UNSENT',
            isUnsent: true,
            text: 'This message was unsent',
            payload: { text: 'This message was unsent' },
            decryptedText: null,
            isDecrypting: false,
            decryptError: false,
            mediaUrl: null,
            mediaType: null,
            inviteData: null,
            replyTo: null,
          } : {})
        };
        return { ...page, messages: updatedMsgs };
      }
      return page;
    });

    if (!found) {
      // In TanStack Query infinite scroll, page 0 contains the most recent messages.
      // Append new incoming or optimistic messages to page 0.
      const page0 = newPages[0] || { messages: [] };
      newPages[0] = {
        ...page0,
        messages: [...(page0.messages || []), message],
      };
    }

    return { ...old, pages: newPages };
  });
}

export function updateMessageInCache(queryClient, activeChatId, targetId, patch) {
  if (!queryClient || !activeChatId || !targetId) return;

  const targetKeys = new Set();
  if (typeof targetId === 'string' || typeof targetId === 'number') {
    targetKeys.add(String(targetId));
  } else if (typeof targetId === 'object' && targetId) {
    if (targetId.id) targetKeys.add(String(targetId.id));
    if (targetId.tempId) targetKeys.add(String(targetId.tempId));
    if (targetId.clientId) targetKeys.add(String(targetId.clientId));
  }
  if (typeof patch === 'object' && patch) {
    if (patch.id) targetKeys.add(String(patch.id));
    if (patch.tempId) targetKeys.add(String(patch.tempId));
    if (patch.clientId) targetKeys.add(String(patch.clientId));
  }

  queryClient.setQueryData(['messages', activeChatId], (old) => {
    if (!old || !old.pages) return old;

    const newPages = old.pages.map((page) => ({
      ...page,
      messages: (page.messages || []).map((m) => {
        const isMatch =
          targetKeys.has(String(m.id)) ||
          (m.tempId && targetKeys.has(String(m.tempId))) ||
          (m.clientId && targetKeys.has(String(m.clientId)));

        if (isMatch) {
          // patch can be an object or a function(existingMsg) => object
          const updates = typeof patch === 'function' ? patch(m) : patch;
          const stableClientId = m.clientId || updates.clientId || m.tempId || updates.tempId;
          const stableTempId = m.tempId || updates.tempId || m.clientId || updates.clientId;
          const isUnsent = m.state === 'UNSENT' || m.isUnsent || updates.state === 'UNSENT' || updates.isUnsent || m.text === 'This message was unsent' || updates.text === 'This message was unsent';
          return {
            ...m,
            ...updates,
            clientId: stableClientId,
            tempId: stableTempId,
            ...(isUnsent ? {
              state: 'UNSENT',
              isUnsent: true,
              text: 'This message was unsent',
              payload: { text: 'This message was unsent' },
              decryptedText: null,
              isDecrypting: false,
              decryptError: false,
              mediaUrl: null,
              mediaType: null,
              inviteData: null,
              replyTo: null,
            } : {})
          };
        }
        return m;
      }),
    }));

    return { ...old, pages: newPages };
  });
}

export function updateConversationPreview(queryClient, conversationId, previewText, timestamp = new Date().toISOString(), unreadIncrement = 0) {
  if (!queryClient || !conversationId) return;

  queryClient.setQueryData(['conversations'], (old) => {
    if (!old) return old;

    let list = Array.isArray(old) ? [...old] : (old.conversations ? [...old.conversations] : null);

    if (!list) return old;

    const idx = list.findIndex((c) => matchesConversationId(c, conversationId));
    if (idx !== -1) {
      const targetConv = {
        ...list[idx],
        lastMsg: previewText || list[idx].lastMsg || list[idx].lastMessageText,
        lastMessageText: previewText || list[idx].lastMessageText,
        updatedAt: timestamp,
        unreadCount: Math.max(0, (list[idx].unreadCount || 0) + unreadIncrement),
        unread: Math.max(0, (list[idx].unread || 0) + unreadIncrement),
      };
      // Move conversation to top of list
      list.splice(idx, 1);
      list.unshift(targetConv);
    }

    return Array.isArray(old) ? list : { ...old, conversations: list };
  });
}

export function updateMessageStatusInCache(queryClient, activeChatId, messageId, status) {
  updateMessageInCache(queryClient, activeChatId, messageId, { status });
}

export function removeMessageFromCache(queryClient, activeChatId, messageId) {
  if (!queryClient || !activeChatId || !messageId) return;

  queryClient.setQueryData(['messages', activeChatId], (old) => {
    if (!old || !old.pages) return old;

    const newPages = old.pages.map((page) => ({
      ...page,
      messages: (page.messages || []).filter((m) => m.id !== messageId),
    }));

    return { ...old, pages: newPages };
  });
}
