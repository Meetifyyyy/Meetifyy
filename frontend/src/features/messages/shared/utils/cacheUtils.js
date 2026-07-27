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

    const newPages = [...old.pages];
    const targetPageIndex = 0; // Page 0 is the most recent page in infinite query
    const targetPage = newPages[targetPageIndex] || { messages: [] };
    const existingMsgs = targetPage.messages || [];

    // Deduplicate by id or tempId
    const existsIndex = existingMsgs.findIndex((m) => 
      (message.id && m.id === message.id) || 
      (message.tempId && (m.tempId === message.tempId || m.id === message.tempId))
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
          return { ...m, ...patch };
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

    const idx = list.findIndex((c) => c.id === conversationId || c.publicId === conversationId);
    if (idx !== -1) {
      const targetConv = {
        ...list[idx],
        lastMessageText: previewText || list[idx].lastMessageText,
        updatedAt: timestamp,
        unreadCount: Math.max(0, (list[idx].unreadCount || 0) + unreadIncrement),
      };
      // Move conversation to top of list (#7)
      list.splice(idx, 1);
      list.unshift(targetConv);
    }

    return Array.isArray(old) ? list : { ...old, conversations: list };
  });
}

export function updateMessageStatusInCache(queryClient, activeChatId, messageId, status) {
  updateMessageInCache(queryClient, activeChatId, messageId, { status });
}
