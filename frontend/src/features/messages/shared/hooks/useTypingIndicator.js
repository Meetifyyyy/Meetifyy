import { useState, useEffect, useRef, useCallback } from 'react';
import { useGlobalSocketStore } from '@shared/store/useGlobalSocketStore';
import { useData } from '@shared/hooks/useData';

export function useTypingIndicator(conversationId, currentUserId) {
  const { socket } = useGlobalSocketStore();
  const { users = {}, conversations = [] } = useData() || {};
  const [typingUsers, setTypingUsers] = useState(new Map());
  const isTypingRef = useRef(false);
  const stopTimerRef = useRef(null);

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
    };
  }, [conversationId, stopTypingNow]);

  // Listen for typing events
  useEffect(() => {
    if (!socket || !conversationId) return;

    const matchedConv = conversations?.find(
      c => String(c.id) === String(conversationId) || String(c.publicId) === String(conversationId) || String(c.internalId) === String(conversationId)
    );

    const allCandidateIds = Array.from(new Set([
      conversationId,
      matchedConv?.id,
      matchedConv?.publicId,
      matchedConv?.internalId
    ].filter(Boolean)));

    // Join rooms explicitly for all ID aliases to ensure zero dropped events
    socket.emit('conversation:join_rooms', { conversationIds: allCandidateIds });

    const isMatch = (receivedId) => {
      if (!receivedId) return false;
      return allCandidateIds.some(id => String(id) === String(receivedId));
    };

    const onTypingStart = (data) => {
      if (!isMatch(data?.conversationId) || data?.userId === currentUserId) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        const name = data.userName || users[data.userId]?.displayName || users[data.userId]?.username || 'Someone';
        next.set(data.userId, name);
        return next;
      });
    };

    const onTypingStop = (data) => {
      if (!isMatch(data?.conversationId)) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.delete(data.userId);
        return next;
      });
    };

    socket.on('typing:start', onTypingStart);
    socket.on('typing:stop', onTypingStop);

    return () => {
      socket.off('typing:start', onTypingStart);
      socket.off('typing:stop', onTypingStop);
    };
  }, [socket, conversationId, currentUserId, users, conversations]);

  const typingNames = Array.from(typingUsers.values());

  return {
    handleKeystroke,
    stopTypingNow,
    typingUsers,
    isTyping: typingNames.length > 0,
    typingText: typingNames.length === 1 
      ? `${typingNames[0]} is typing...` 
      : typingNames.length > 1 
        ? `${typingNames.join(', ')} are typing...` 
        : ''
  };
}
