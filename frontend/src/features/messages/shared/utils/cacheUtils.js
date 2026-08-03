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

  // NOTE: Participant user-IDs are intentionally excluded from matchesConversationId.
  // Including them caused DM participant IDs to match group chats containing those users,
  // leaking previews, unread counts, and cache updates across unrelated chats.

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

  return Array.from(set);
}

export function checkIsMe(msg, currentUser) {
  if (!msg) return false;
  if (msg.from === 'me' || msg.senderId === 'me' || msg.fromMe === true) return true;
  if (msg.from === 'them' && msg.senderId && msg.senderId !== 'me') return false;

  let myId = currentUser?.id || currentUser?._id || currentUser?.userId;

  // Fallback during initial hydration if currentUser is temporarily loading
  if (!myId && typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('user') || localStorage.getItem('auth_user') || localStorage.getItem('currentUser');
      if (stored) {
        const parsed = JSON.parse(stored);
        myId = parsed?.id || parsed?._id || parsed?.userId;
      }
    } catch {}
  }

  if (!myId) return false;
  const sId = msg.senderId || msg.sender?.id || msg.sender?._id || msg.userId;
  return sId != null && String(sId) === String(myId);
}

export function getMsgTimestamp(m) {
  if (!m) return 0;
  const val = m.createdAt || m.timestamp || m.sendingAt || m.storedAt;
  if (!val) return m.storedAt || 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;

  const d = new Date(val);
  let t = d.getTime();

  if (isNaN(t) && typeof val === 'string') {
    // Try parsing time strings like "10:23 PM" or "8:43 AM"
    const match = val.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const ampm = match[3] ? match[3].toUpperCase() : null;
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      const now = new Date();
      now.setHours(hours, minutes, 0, 0);
      t = now.getTime();
    }
  }

  if (isNaN(t)) {
    return m.storedAt || 0;
  }
  return t;
}

/**
 * Single Authoritative Deterministic Message Comparator.
 * Sorts messages strictly in ascending chronological order (oldest first).
 * Primary sort key: timestamp (epoch ms)
 * Secondary sort key (tie-breaker): ID / clientId / tempId alphabetical comparison
 */
export function compareMessages(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const timeA = getMsgTimestamp(a);
  const timeB = getMsgTimestamp(b);

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  // Tie-breaker using stable identifier string
  const idA = String(a.id || a.clientId || a.tempId || '');
  const idB = String(b.id || b.clientId || b.tempId || '');
  return idA.localeCompare(idB);
}

// Shared status rank — higher = further along the delivery pipeline.
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

    const matchesMsg = (m) => {
      const targetClientId = message.clientId || message.tempId || (message.payload && (message.payload.clientId || message.payload.tempId));
      const targetId = message.id;

      if (targetId && m.id === targetId) return true;
      if (targetClientId && (m.clientId === targetClientId || m.tempId === targetClientId || m.id === targetClientId)) return true;
      if (targetId && (m.tempId === targetId || m.clientId === targetId)) return true;

      // Fallback match for pending/sending/failed messages with matching text content & sender
      const isSendingOrFailed = m.status === 'sending' || m.status === 'failed' || m.status === 'FAILED';
      const mText = (m.text || m.payload?.text || '').trim();
      const incomingText = (message.text || message.payload?.text || '').trim();
      
      if (isSendingOrFailed && incomingText && mText === incomingText) {
        const mSender = String(m.senderId || m.sender?.id || '');
        const incomingSender = String(message.senderId || message.sender?.id || '');
        if (!mSender || !incomingSender || mSender === incomingSender || mSender === 'me' || incomingSender === 'me') {
          return true;
        }
      }

      return false;
    };

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

        // Preserve read/seen status over sent/delivered status
        let resolvedStatus = message.status || existing.status;
        if ((existing.status === 'read' || existing.status === 'seen') && (message.status === 'sent' || message.status === 'delivered')) {
          resolvedStatus = existing.status;
        }

        const isExplicitUnsent = message.state === 'UNSENT' || message.isUnsent === true || message.text === 'This message was unsent';
        const isResetting = message.status === 'sending' || message.state === 'SENT' || (typeof message.text === 'string' && message.text !== 'This message was unsent' && message.text !== '');

        const isUnsent = isExplicitUnsent || (!isResetting && (existing.state === 'UNSENT' || existing.isUnsent || existing.text === 'This message was unsent'));

        const updatedMessage = {
          ...existing,
          ...message,
          clientId: stableClientId,
          tempId: stableTempId,
          status: resolvedStatus,
        };

        if (isUnsent) {
          updatedMessage.state = 'UNSENT';
          updatedMessage.isUnsent = true;
          updatedMessage.text = 'This message was unsent';
          updatedMessage.payload = { text: 'This message was unsent' };
          updatedMessage.decryptedText = null;
          updatedMessage.isDecrypting = false;
          updatedMessage.decryptError = false;
          updatedMessage.mediaUrl = null;
          updatedMessage.mediaType = null;
          updatedMessage.inviteData = null;
          updatedMessage.replyTo = null;
        } else if (isResetting && (existing.state === 'UNSENT' || existing.isUnsent)) {
          updatedMessage.state = 'SENT';
          updatedMessage.isUnsent = false;
        }

        updatedMsgs[idx] = updatedMessage;
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

          const isExplicitUnsent = updates.state === 'UNSENT' || updates.isUnsent === true || updates.text === 'This message was unsent';
          const isResetting = updates.status === 'sending' || updates.state === 'SENT' || (typeof updates.text === 'string' && updates.text !== 'This message was unsent' && updates.text !== '');

          const isUnsent = isExplicitUnsent || (!isResetting && (m.state === 'UNSENT' || m.isUnsent || m.text === 'This message was unsent'));

          const resMsg = {
            ...m,
            ...updates,
            clientId: stableClientId,
            tempId: stableTempId,
          };

          if (isUnsent) {
            resMsg.state = 'UNSENT';
            resMsg.isUnsent = true;
            resMsg.text = 'This message was unsent';
            resMsg.payload = { text: 'This message was unsent' };
            resMsg.decryptedText = null;
            resMsg.isDecrypting = false;
            resMsg.decryptError = false;
            resMsg.mediaUrl = null;
            resMsg.mediaType = null;
            resMsg.inviteData = null;
            resMsg.replyTo = null;
          } else if (isResetting && (m.state === 'UNSENT' || m.isUnsent)) {
            resMsg.state = 'SENT';
            resMsg.isUnsent = false;
          }

          return resMsg;
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

    const numericTimestamp = new Date(timestamp).getTime();
    const idx = list.findIndex((c) => matchesConversationId(c, conversationId));
    if (idx !== -1) {
      let textVal = typeof previewText === 'string' ? previewText : (previewText?.text || '');
      const prevMsgObj = list[idx].lastMessage || {};
      
      if (!textVal && (previewText?.inviteData || prevMsgObj?.inviteData)) {
        const inv = previewText?.inviteData || prevMsgObj?.inviteData;
        textVal = inv?.groupName ? `Group invite: ${inv.groupName}` : 'Group invite';
      } else if (!textVal && (previewText?.mediaType || prevMsgObj?.mediaType)) {
        const mt = previewText?.mediaType || prevMsgObj?.mediaType;
        textVal = mt === 'image' ? 'Photo' : mt === 'video' ? 'Video' : 'Audio';
      } else if (!textVal && (previewText?.mediaUrl || prevMsgObj?.mediaUrl)) {
        textVal = 'Media';
      }

      const newMsgObj = {
        ...prevMsgObj,
        text: textVal,
        createdAt: timestamp
      };

      const targetConv = {
        ...list[idx],
        lastMsg: textVal || list[idx].lastMsg || '',
        lastMessageText: textVal || list[idx].lastMessageText || '',
        lastMessage: newMsgObj,
        updatedAt: timestamp,
        timestamp: numericTimestamp,
        unreadCount: Math.max(0, (list[idx].unreadCount || 0) + unreadIncrement),
        unread: Math.max(0, (list[idx].unread || 0) + unreadIncrement),
      };

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
