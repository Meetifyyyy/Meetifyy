import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi, dmApi, groupApi, activityChatApi } from '@shared/api/apiClient';
import { useGlobalSocketStore } from '@shared/store/useGlobalSocketStore';
import { E2EEManager } from '@shared/lib/signal/E2EEManager';
import { processAndUploadImage, uploadFileDirect } from '@shared/utils/mediaPipeline';
import { useData } from '@shared/hooks/useData';
import { appendMessageToCache, updateMessageInCache, updateConversationPreview } from '../utils/cacheUtils';
import { queuePendingMessage, removePendingMessage } from '../utils/offlineSync';

export function useChatManager(activeChatId, type = 'messages', currentUserParam) {
  const queryClient = useQueryClient();
  const { socket } = useGlobalSocketStore();
  const { conversations = [], currentUser: dataUser } = useData() || {};
  const currentUser = currentUserParam || dataUser;
  const e2ee = E2EEManager.getInstance();

  const isNearBottomRef = useRef(true);

  const getApi = () => {
    switch(type) {
      case 'dm': return dmApi;
      case 'group': return groupApi;
      case 'activity': return activityChatApi;
      default: return messagesApi;
    }
  };

  const {
    data: historyPages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey: ['messages', activeChatId],
    queryFn: ({ pageParam }) => activeChatId ? getApi().getHistory(activeChatId, undefined, pageParam) : null,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    enabled: !!activeChatId && !String(activeChatId).startsWith('temp_') && !String(activeChatId).startsWith('c_temp_'),
    staleTime: 1000 * 30,
  });

  // Decrypt E2EE messages on the fly (optimistic/background)
  useEffect(() => {
    if (!historyPages?.pages) return;
    
    let modified = false;
    const newPages = historyPages.pages.map(page => {
      if (!page?.messages) return page;
      const decMsgs = [...page.messages];
      let pageModified = false;

      decMsgs.forEach((msg) => {
        const textVal = msg.text || msg.payload?.text || '';
        const isE2EEPayload = msg.type === 'e2ee' || msg.isE2EE || (typeof textVal === 'string' && textVal.startsWith('{"type":') && textVal.includes('"body":'));
        
        if (isE2EEPayload && textVal && !msg.decryptedText && !msg.isDecrypting && !msg.decryptError) {
          pageModified = true;
          modified = true;
          
          msg.isDecrypting = true;
          
          let cipherObj;
          try {
            cipherObj = typeof textVal === 'string' ? JSON.parse(textVal) : textVal;
          } catch (e) {
            cipherObj = textVal;
          }

          const cipherBody = cipherObj.body || cipherObj;
          const cipherType = cipherObj.type || 3;
          
          e2ee.decryptMessage(msg.senderId, msg.deviceId || '1', cipherType, cipherBody)
            .then(plaintext => {
              queryClient.setQueryData(['messages', activeChatId], (old) => {
                if (!old) return old;
                return {
                  ...old,
                  pages: old.pages.map(p => ({
                    ...p,
                    messages: (p.messages || []).map(m => m.id === msg.id ? { ...m, decryptedText: plaintext, isDecrypting: false, text: plaintext } : m)
                  }))
                };
              });
            })
            .catch(err => {
              console.error('Decryption error', err);
              queryClient.setQueryData(['messages', activeChatId], (old) => {
                if (!old) return old;
                return {
                  ...old,
                  pages: old.pages.map(p => ({
                    ...p,
                    messages: (p.messages || []).map(m => m.id === msg.id ? { ...m, decryptError: true, isDecrypting: false, text: '[Encrypted Message]' } : m)
                  }))
                };
              });
            });
        }
      });
      return pageModified ? { ...page, messages: decMsgs } : page;
    });
  }, [historyPages, activeChatId, queryClient, e2ee]);

  const allMessages = useMemo(() => {
    if (!historyPages?.pages) return [];
    const reversedPages = [...historyPages.pages].reverse();
    const flat = reversedPages.flatMap(page => page?.messages || []);
    
    const seen = new Set();
    return flat.filter(m => {
      if (!m) return false;
      const key = m.id || m.tempId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [historyPages]);

  // Strict Seen Evaluator: checks all 5 conditions (open, active app, visible window, near bottom, rendered)
  const markSeenIfEligible = useCallback((isNearBottom = true) => {
    isNearBottomRef.current = isNearBottom;

    if (!socket?.connected || !activeChatId) return;
    if (typeof document === 'undefined') return;

    const isVisible = document.visibilityState === 'visible';
    const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

    if (isVisible && hasFocus && isNearBottom) {
      const lastMsg = allMessages[allMessages.length - 1];
      socket.emit('messages:seen', {
        conversationId: activeChatId,
        lastMessageId: lastMsg?.id,
      });
      socket.emit('conversation:mark_seen', {
        conversationId: activeChatId,
        lastMessageId: lastMsg?.id,
      });
    }
  }, [socket, activeChatId, allMessages]);

  // Listen for window focus & tab visibility changes
  useEffect(() => {
    if (!socket || !activeChatId) return;

    const handleActiveStateChange = () => {
      markSeenIfEligible(isNearBottomRef.current);
    };

    window.addEventListener('focus', handleActiveStateChange);
    window.addEventListener('blur', handleActiveStateChange);
    document.addEventListener('visibilitychange', handleActiveStateChange);

    return () => {
      window.removeEventListener('focus', handleActiveStateChange);
      window.removeEventListener('blur', handleActiveStateChange);
      document.removeEventListener('visibilitychange', handleActiveStateChange);
    };
  }, [socket, activeChatId, markSeenIfEligible]);

  // Optimistic Message Sender (supports both positional arguments and single object parameter)
  const sendMessageOptimistically = useCallback(async (convIdOrObj, textArg, replyToArg, mentionsArg, mediaUrlArg, mediaTypeArg, explicitLinkPreviewArg, explicitInviteDataArg, optionsArg) => {
    let convId, text, replyTo, mentions, mediaUrl, mediaType, explicitInviteData, fileObj, options;

    if (convIdOrObj && typeof convIdOrObj === 'object' && !Array.isArray(convIdOrObj)) {
      const obj = convIdOrObj;
      convId = obj.conversationId || activeChatId;
      text = obj.text;
      replyTo = obj.replyTo;
      mentions = obj.mentions || [];
      mediaUrl = obj.mediaUrl;
      mediaType = obj.mediaType;
      explicitInviteData = obj.inviteData || obj.explicitInviteData;
      fileObj = obj.fileObj;
      options = obj;
    } else {
      convId = convIdOrObj || activeChatId;
      text = textArg;
      replyTo = replyToArg;
      mentions = mentionsArg || [];
      mediaUrl = mediaUrlArg;
      mediaType = mediaTypeArg;
      explicitInviteData = explicitInviteDataArg;
      options = optionsArg || {};
      fileObj = options?.fileObj;
    }

    const targetConvId = convId || activeChatId;
    if (!targetConvId) return;

    let payloadText = typeof text === 'string' ? text : '';
    if (text && typeof text === 'object' && !Array.isArray(text)) {
      payloadText = text.text || '';
    }

    const tempId = options?.tempId || `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tempMessage = {
      id: tempId,
      tempId,
      conversationId: targetConvId,
      senderId: currentUser?.id || 'me',
      sender: currentUser || { id: 'me' },
      from: 'me',
      text: payloadText,
      payload: { text: payloadText, mediaUrl, mediaType, mentions, inviteData: explicitInviteData },
      replyTo,
      status: 'sending',
      createdAt: new Date().toISOString(),
    };

    appendMessageToCache(queryClient, targetConvId, tempMessage);
    updateConversationPreview(queryClient, targetConvId, payloadText, tempMessage.createdAt, 0);

    let finalMediaUrl = mediaUrl;

    if (fileObj) {
      try {
        const file = fileObj;
        let uploadRes;
        if (file.type.startsWith('image/')) {
          uploadRes = await processAndUploadImage(file, 'messages');
        } else {
          uploadRes = await uploadFileDirect(file, 'messages');
        }
        if (uploadRes?.publicUrl) {
          finalMediaUrl = uploadRes.publicUrl;
          updateMessageInCache(queryClient, targetConvId, tempId, {
            mediaUrl: finalMediaUrl,
            payload: { ...tempMessage.payload, mediaUrl: finalMediaUrl }
          });
        }
      } catch (err) {
        updateMessageInCache(queryClient, targetConvId, tempId, { status: 'failed' });
        return;
      }
    }

    const payload = {
      tempId,
      conversationId: targetConvId,
      text: payloadText,
      mediaUrl: finalMediaUrl,
      mediaType,
      mentions,
      replyToId: replyTo?.id,
      inviteData: explicitInviteData,
    };

    if (socket?.connected) {
      socket.emit('message:send', payload, (response) => {
        if (response?.status === 'ok') {
          if (response.message) {
            updateMessageInCache(queryClient, targetConvId, tempId, {
              ...response.message,
              id: response.message.id || tempId,
              status: 'sent',
            });
          } else {
            updateMessageInCache(queryClient, targetConvId, tempId, { status: 'sent' });
          }
          removePendingMessage(tempId);
        } else {
          updateMessageInCache(queryClient, targetConvId, tempId, { status: 'failed' });
          queuePendingMessage({ ...payload, tempId });
        }
      });
    } else {
      try {
        const res = await getApi().sendMessage(targetConvId, payload);
        updateMessageInCache(queryClient, targetConvId, tempId, {
          ...res,
          id: res?.id || tempId,
          status: 'sent',
        });
        removePendingMessage(tempId);
      } catch (err) {
        updateMessageInCache(queryClient, targetConvId, tempId, { status: 'failed' });
        queuePendingMessage({ ...payload, tempId });
      }
    }
  }, [activeChatId, currentUser, queryClient, socket]);

  // Socket sync & Room Management
  useEffect(() => {
    if (!socket || !activeChatId) return;

    const matchedConv = conversations?.find(
      c => String(c.id) === String(activeChatId) || String(c.publicId) === String(activeChatId) || String(c.internalId) === String(activeChatId)
    );

    const allCandidateIds = Array.from(new Set([
      activeChatId,
      matchedConv?.id,
      matchedConv?.publicId,
      matchedConv?.internalId
    ].filter(Boolean)));

    socket.emit('conversation:join_rooms', { conversationIds: allCandidateIds });
    
    markSeenIfEligible(isNearBottomRef.current);

    const isMatch = (receivedId) => {
      if (!receivedId) return false;
      return allCandidateIds.some(id => String(id) === String(receivedId));
    };

    // Step 3: Recipient sends Delivery ACK (message:received) when receiving a new message
    const handleIncomingNewMessage = (payload) => {
      const msg = payload?.message || payload;
      const convId = payload?.conversationId || msg?.conversationId;
      const isMyMsg = msg?.from === 'me' || String(msg?.senderId) === String(currentUser?.id) || msg?.senderId === 'me';
      
      if (isMatch(convId) && msg && !isMyMsg) {
        if (msg.id && socket?.connected) {
          socket.emit('message:received', {
            conversationId: activeChatId,
            messageId: msg.id,
          });
        }
        markSeenIfEligible(isNearBottomRef.current);
      }
    };

    // Step 3: Sender receives Delivery ACK (message:delivered)
    const handleMessageDelivered = (payload) => {
      if (!payload || !isMatch(payload.conversationId)) return;
      const targetId = payload.messageId;

      queryClient.setQueryData(['messages', activeChatId], (oldData) => {
        if (!oldData?.pages) return oldData;
        let hasChanges = false;
        const newPages = oldData.pages.map(page => {
          if (!page.messages) return page;
          const newMessages = page.messages.map(msg => {
            if ((msg.id === targetId || !targetId) && msg.status !== 'read' && msg.status !== 'seen') {
              hasChanges = true;
              return { ...msg, status: 'delivered' };
            }
            return msg;
          });
          return { ...page, messages: newMessages };
        });
        return hasChanges ? { ...oldData, pages: newPages } : oldData;
      });
    };

    // Step 4: Sender receives Seen ACK (messages:seen or conversation:seen)
    const handleConversationSeen = (data) => {
      const isTargetMatch = isMatch(data?.conversationId) || isMatch(data?.realConvId);
      const isRecipientReader = !data?.readerId || String(data.readerId) !== String(currentUser?.id);

      if (isTargetMatch && isRecipientReader && data?.lastReadAt) {
        const lastReadTime = new Date(data.lastReadAt).getTime();
        
        queryClient.setQueryData(['messages', activeChatId], (oldData) => {
          if (!oldData?.pages) return oldData;
          
          let hasChanges = false;
          const newPages = oldData.pages.map(page => {
            if (!page.messages) return page;
            const newMessages = page.messages.map(msg => {
              const isMyMsg = msg.from === 'me' || String(msg.senderId) === String(currentUser?.id) || msg.senderId === 'me';
              if (isMyMsg && msg.status !== 'read') {
                const msgTime = new Date(msg.createdAt).getTime();
                if (isNaN(msgTime) || msgTime <= lastReadTime + 2000) {
                  hasChanges = true;
                  return { ...msg, status: 'read' };
                }
              }
              return msg;
            });
            return { ...page, messages: newMessages };
          });
          
          return hasChanges ? { ...oldData, pages: newPages } : oldData;
        });
      }
    };

    socket.on('message:new', handleIncomingNewMessage);
    socket.on('message:delivered', handleMessageDelivered);
    socket.on('messages:seen', handleConversationSeen);
    socket.on('conversation:seen', handleConversationSeen);
    
    return () => {
      socket.off('message:new', handleIncomingNewMessage);
      socket.off('message:delivered', handleMessageDelivered);
      socket.off('messages:seen', handleConversationSeen);
      socket.off('conversation:seen', handleConversationSeen);
    };
  }, [socket, activeChatId, queryClient, currentUser, conversations, markSeenIfEligible]);

  return {
    messages: allMessages,
    rawPages: historyPages?.pages,
    isLoading,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    onLoadMore: fetchNextPage,
    sendMessageOptimistically,
    markSeenIfEligible,
  };
}
