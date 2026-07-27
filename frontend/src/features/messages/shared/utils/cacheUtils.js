/**
 * Smart Cache Utilities for TanStack Query
 * Enables direct cache updates to eliminate full query invalidations and flickering.
 */

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

    // Deduplicate by id or tempId
    const existsIndex = existingMsgs.findIndex((m) =>
      (message.id && m.id === message.id) ||
      (message.tempId && (m.tempId === message.tempId || m.id === message.tempId)) ||
      (message.id && m.tempId === message.id)
    );

    let updatedMsgs;
    if (existsIndex !== -1) {
      updatedMsgs = [...existingMsgs];
      updatedMsgs[existsIndex] = { ...existingMsgs[existsIndex], ...message };
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
        if (m.id === targetId || m.tempId === targetId) {
          // patch can be an object or a function(existingMsg) => object
          const updates = typeof patch === 'function' ? patch(m) : patch;
          return { ...m, ...updates };
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

    const idx = list.findIndex((c) =>
      c.id === conversationId ||
      c.publicId === conversationId ||
      c.internalId === conversationId
    );
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
