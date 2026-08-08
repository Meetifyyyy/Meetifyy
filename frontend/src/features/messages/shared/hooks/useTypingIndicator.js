import { useState, useEffect, useRef, useCallback } from 'react';
import { useGlobalSocketStore } from '@shared/stores/useGlobalSocketStore';
import { useData } from '@shared/hooks/useData';

export function useTypingIndicator(conversationId, currentUserId) {
  const { socket } = useGlobalSocketStore();
  const { users = {}, conversations = [] } = useData() || {};
  const [typingUsers, setTypingUsers] = useState(new Map());
  const isTypingRef = useRef(false);
  const stopTimerRef = useRef(null);
  const autoClearTimersRef = useRef(new Map());

  // Send typing events
  const handleKeystroke = useCallback(() => {
    if (!socket || !conversationId) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing:start', { conversationId });
    }

    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
    }

    stopTimerRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        socket.emit('typing:stop', { conversationId });
      }
    }, 2000);
  }, [socket, conversationId]);

  const stopTypingNow = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
    }
    if (isTypingRef.current && socket && conversationId) {
      isTypingRef.current = false;
      socket.emit('typing:stop', { conversationId });
    }
  }, [socket, conversationId]);

  // Cleanup on conversation change or unmount
  useEffect(() => {
    return () => {
      stopTypingNow();
      autoClearTimersRef.current.forEach((timer) => clearTimeout(timer));
      autoClearTimersRef.current.clear();
      setTypingUsers(new Map());
    };
  }, [conversationId, stopTypingNow]);

  const conversationsRef = useRef(conversations);
  const usersRef = useRef(users);
  useEffect(() => {
    conversationsRef.current = conversations;
    usersRef.current = users;
  }, [conversations, users]);

  // Listen for typing, message, and presence events
  useEffect(() => {
    if (!socket || !conversationId) return;

    const matchedConv = conversationsRef.current?.find(
      c =>
        String(c.id) === String(conversationId) ||
        String(c.publicId) === String(conversationId) ||
        String(c.internalId) === String(conversationId) ||
        (c.activityId && `act_${c.activityId}` === String(conversationId))
    );

    const cleanId = String(conversationId).replace(/^(act_)+/, '');

    const allCandidateIds = Array.from(
      new Set(
        [
          conversationId,
          cleanId,
          matchedConv?.id,
          matchedConv?.publicId,
          matchedConv?.internalId,
          matchedConv?.activityId ? `act_${matchedConv.activityId}` : null
        ].filter(Boolean)
      )
    );

    socket.emit('conversation:join_rooms', { conversationIds: allCandidateIds });

    const isMatch = (receivedId) => {
      if (!receivedId) return false;
      const cleanRecId = String(receivedId).replace(/^(act_)+/, '');
      return allCandidateIds.some(id => String(id) === String(receivedId) || String(id) === cleanRecId);
    };

    const clearUserTyping = (uId) => {
      if (!uId) return;
      if (autoClearTimersRef.current.has(uId)) {
        clearTimeout(autoClearTimersRef.current.get(uId));
        autoClearTimersRef.current.delete(uId);
      }
      setTypingUsers((prev) => {
        if (!prev.has(uId)) return prev;
        const next = new Map(prev);
        next.delete(uId);
        return next;
      });
    };

    const onTypingStart = (data) => {
      if (!isMatch(data?.conversationId) || data?.userId === currentUserId) return;

      const uId = data.userId;
      if (!uId) return;

      // Clear any existing auto-clear timer for this user
      if (autoClearTimersRef.current.has(uId)) {
        clearTimeout(autoClearTimersRef.current.get(uId));
        autoClearTimersRef.current.delete(uId);
      }

      setTypingUsers((prev) => {
        const next = new Map(prev);
        const name = data.userName || users[uId]?.displayName || users[uId]?.username || 'Someone';
        next.set(uId, name);
        return next;
      });

      // Auto-clear after 5 seconds of inactivity to prevent indicator lingering forever if tab closes
      const timer = setTimeout(() => {
        clearUserTyping(uId);
      }, 5000);
      autoClearTimersRef.current.set(uId, timer);
    };

    const onTypingStop = (data) => {
      if (!isMatch(data?.conversationId)) return;
      clearUserTyping(data?.userId);
    };

    const onNewMessage = (payload) => {
      const msg = payload?.message || payload;
      const convId = payload?.conversationId || msg?.conversationId;
      if (isMatch(convId)) {
        const senderId = msg?.senderId || msg?.from;
        if (senderId) {
          clearUserTyping(senderId);
        }
      }
    };

    const onPresenceUpdate = (data) => {
      if (data?.status === 'offline' && data?.userId) {
        clearUserTyping(data.userId);
      }
    };

    socket.on('typing:start', onTypingStart);
    socket.on('typing:stop', onTypingStop);
    socket.on('message:new', onNewMessage);
    socket.on('presence:update', onPresenceUpdate);

    return () => {
      socket.off('typing:start', onTypingStart);
      socket.off('typing:stop', onTypingStop);
      socket.off('message:new', onNewMessage);
      socket.off('presence:update', onPresenceUpdate);
    };
  }, [socket, conversationId, currentUserId]);

  const typingNames = Array.from(typingUsers.values());

  return {
    handleKeystroke,
    stopTypingNow,
    typingUsers,
    isTyping: typingNames.length > 0,
    typingText:
      typingNames.length === 1
        ? `${typingNames[0]} is typing...`
        : typingNames.length > 1
        ? `${typingNames.join(', ')} are typing...`
        : ''
  };
}
