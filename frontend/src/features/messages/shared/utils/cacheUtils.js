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

  const participants = c.participants || c.members || [];
  for (const p of participants) {
    if (!p) continue;
    if (p.userId) set.add(String(p.userId).trim());
    if (p.id) set.add(String(p.id).trim());
    if (p.username) set.add(String(p.username).trim());
  }

  return Array.from(set);
}

export function appendMessageToCache(queryClient, activeChatId, message) {
  if (!queryClient || !activeChatId || !message) return;

  queryClient.setQueryData(['messages', activeChatId], (old) => {
    if (!old || !old.pages || old.pages.length === 0) {
      return {
        pages: [{ messages: [message], nextCursor: undefined }],
        pageParams: [undefined],
      };
    }

    // In TanStack Query infinite scroll, pages are ordered oldest→newest.
    // New messages always go on the LAST page (most recent).
    const newPages = [...old.pages];
    const targetPageIndex = newPages.length - 1;
    const targetPage = newPages[targetPageIndex] || { messages: [] };
    const existingMsgs = targetPage.messages || [];

    // Deduplicate by id, clientId, or tempId
    const existsIndex = existingMsgs.findIndex((m) =>
      (message.id && m.id === message.id) ||
      (message.clientId && (m.clientId === message.clientId || m.tempId === message.clientId || m.id === message.clientId)) ||
      (message.tempId && (m.tempId === message.tempId || m.clientId === message.tempId || m.id === message.tempId)) ||
      (message.id && (m.tempId === message.id || m.clientId === message.id))
    );

    let updatedMsgs;
    if (existsIndex !== -1) {
      updatedMsgs = [...existingMsgs];
      const existing = existingMsgs[existsIndex];
      const stableClientId = existing.clientId || message.clientId || existing.tempId || message.tempId;
      const stableTempId = existing.tempId || message.tempId || existing.clientId || message.clientId;
      updatedMsgs[existsIndex] = {
        ...existing,
        ...message,
        clientId: stableClientId,
        tempId: stableTempId,
      };
    } else {
      updatedMsgs = [...existingMsgs, message];
    }

    newPages[targetPageIndex] = { ...targetPage, messages: updatedMsgs };
    return { ...old, pages: newPages };
  });
}

export function updateMessageInCache(queryClient, activeChatId, targetId, patch) {
  if (!queryClient || !activeChatId || !targetId) return;

  queryClient.setQueryData(['messages', activeChatId], (old) => {
    if (!old || !old.pages) return old;

    const newPages = old.pages.map((page) => ({
      ...page,
      messages: (page.messages || []).map((m) => {
        if (m.id === targetId || m.tempId === targetId || m.clientId === targetId) {
          // patch can be an object or a function(existingMsg) => object
          const updates = typeof patch === 'function' ? patch(m) : patch;
          const stableClientId = m.clientId || updates.clientId || m.tempId || updates.tempId;
          const stableTempId = m.tempId || updates.tempId || m.clientId || updates.clientId;
          return {
            ...m,
            ...updates,
            clientId: stableClientId,
            tempId: stableTempId,
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
