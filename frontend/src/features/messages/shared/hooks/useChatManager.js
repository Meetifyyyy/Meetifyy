import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi, dmApi, groupApi } from '@shared/api/apiClient';
import { useGlobalSocketStore } from '@shared/stores/useGlobalSocketStore';
import { processAndUploadImage, processAndUploadVideo, uploadFileDirect, getImageDimensions } from '@shared/utils/mediaPipeline';
import { useData } from '@shared/hooks/useData';
import { appendMessageToCache, updateMessageInCache, updateConversationPreview, matchesConversationId, getConversationAliases, compareMessages, STATUS_RANK, checkIsMe } from '../utils/cacheUtils';

import { idbGetMessages, idbSaveMessages, idbPatchMessage, idbDeleteMessage, migrateHistoricalFailedMessages, trimMessageCache } from '../utils/idbMessages';


// Throttles upload-progress writes so a fast XHR can't flood React state.
// Emits on leading edge, then at most once per `interval` ms, and always the
// final value — keeps the progress ring smooth without re-rendering per byte.
function makeProgressThrottle(fn, interval = 150) {
  let last = 0;
  let pending = null;
  let timer = null;
  const flush = () => {
    timer = null;
    if (pending != null) {
      last = Date.now();
      const v = pending;
      pending = null;
      fn(v);
    }
  };
  return (value) => {
    const now = Date.now();
    if (now - last >= interval) {
      last = now;
      fn(value);
    } else {
      pending = value;
      if (!timer) timer = setTimeout(flush, interval - (now - last));
    }
  };
}

export function useChatManager(activeChatId, type = 'messages', currentUserParam) {
  const queryClient = useQueryClient();
  const { socket } = useGlobalSocketStore();
  // Tracks in-flight/failed media uploads so they can be retried or cancelled
  // by clientId without duplicating the message. Value shape:
  // { file, mediaType, targetConvId, localPreviewUrl, abortController, sendArgs }
  const pendingUploadsRef = useRef(new Map());
  const { conversations = [], currentUser: dataUser } = useData() || {};
  const currentUser = currentUserParam || dataUser;

  // Run historical failed messages migration on startup, then bound the local
  // message/media-metadata cache so IndexedDB can't grow without limit.
  useEffect(() => {
    migrateHistoricalFailedMessages().catch(console.warn);
    trimMessageCache().catch(console.warn);
  }, []);

  const isNearBottomRef = useRef(true);

  const getApi = () => {
    switch(type) {
      case 'dm': return dmApi;
      case 'group': return groupApi;
      default: return messagesApi;
    }
  };

  const [idbLoaded, setIdbLoaded] = useState(false);
  // IDB messages are stored here as placeholder — they are NOT injected into the
  // TanStack cache directly (which would set isLoading:false prematurely).
  // Instead they are passed as placeholderData so the query still reports isLoading:true
  // until the network confirms. Once network responds, its data takes over seamlessly.
  const idbPlaceholderRef = useRef(null);

  useEffect(() => {
    if (!activeChatId) {
      setIdbLoaded(false);
      idbPlaceholderRef.current = null;
      return;
    }
    let cancelled = false;
    const targetChatId = activeChatId;

    // Reset placeholder for the new chat
    idbPlaceholderRef.current = null;

    // If TanStack cache already has NETWORK data for this chat, skip IDB entirely.
    // Network data is identified by having a non-placeholder source — we just check
    // if the query is not in loading state by looking at existing pages.
    const currentData = queryClient.getQueryData(['messages', targetChatId]);
    if (currentData?.pages?.length > 0) {
      setIdbLoaded(true);
      return;
    }

    setIdbLoaded(false);

    const matchedConv = conversations?.find((c) => matchesConversationId(c, targetChatId));
    const aliases = getConversationAliases(matchedConv);
    const candidateIds = Array.from(new Set([targetChatId, ...aliases].filter(Boolean)));

    idbGetMessages(candidateIds).then(messages => {
      if (cancelled) return;

      if (messages && messages.length > 0) {
        // Build page structure for placeholderData — same shape as network response
        const PAGE_SIZE = 50;
        const pages = [];
        const pageParams = [];
        const total = messages.length;
        for (let end = total; end > 0; end -= PAGE_SIZE) {
          const start = Math.max(0, end - PAGE_SIZE);
          const pageMsgs = messages.slice(start, end);
          const oldestInPage = pageMsgs[0];
          const nextCursor = start > 0 && oldestInPage
            ? (oldestInPage.createdAt ? `${new Date(oldestInPage.createdAt).toISOString()}|${oldestInPage.id}` : oldestInPage.id)
            : undefined;
          pages.push({ messages: pageMsgs, nextCursor });
          pageParams.push(pages.length === 1 ? undefined : nextCursor);
        }
        // Store as placeholder — will be used by useInfiniteQuery's placeholderData option
        if (!cancelled) idbPlaceholderRef.current = { pages, pageParams };
      }

      if (!cancelled) setIdbLoaded(true);
    }).catch(() => {
      if (!cancelled) setIdbLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [activeChatId, conversations, queryClient]);


  const {
    data: historyPages,
    isLoading,
    isFetching,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey: ['messages', activeChatId],
    queryFn: async ({ pageParam }) => {
      if (!activeChatId) return null;
      const res = await getApi().getHistory(activeChatId, undefined, pageParam);
      if (res && res.messages) {
        const normalizedMsgs = res.messages.map(m => ({
          ...m,
          status: m.status || 'sent',
        }));
        res.messages = normalizedMsgs;
        idbSaveMessages(activeChatId, normalizedMsgs).catch(console.warn);
        // After network confirms, clear the IDB placeholder — network data owns the cache now
        idbPlaceholderRef.current = null;
      }
      return res;
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    enabled: !!activeChatId && !String(activeChatId).startsWith('temp_') && !String(activeChatId).startsWith('c_temp_'),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    // placeholderData shows IDB content while network is in-flight WITHOUT setting isLoading:false.
    // The key insight: placeholderData keeps isLoading:true (or isFetching:true) so callers know
    // the data is not yet confirmed by the server. The flicker is eliminated because we show
    // a loading skeleton instead of IDB messages during the brief network fetch.
    placeholderData: undefined,
  });

  // Expose a combined loading state: true when we have no CONFIRMED network data yet.
  // This is used by MessagesLayout to show a skeleton while the first network fetch is in-flight,
  // even if IDB has data (which would otherwise flash before network responds).
  const isLoadingMessages = isLoading || (isFetching && !historyPages?.pages?.length);


  const allMessages = useMemo(() => {
    if (!historyPages?.pages) return [];
    const reversedPages = [...historyPages.pages].reverse();
    const flat = reversedPages.flatMap(page => page?.messages || []);

    // Prefer the permanent server ID as the dedup key so that optimistic messages
    // (which temporarily share clientId=tempId=id) are correctly collapsed once
    // the server ACK arrives with a real UUID.
    const seen = new Set();
    const deduped = flat.filter(m => {
      if (!m) return false;
      const key = m.id || m.clientId || m.tempId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduped.sort(compareMessages);
  }, [historyPages]);

  const lastMarkedReadRef = useRef(null);
  const markReadDebounceRef = useRef(null);
  // Tracks the most-recent seen event so a late-arriving socket ACK can
  // back-apply 'read' status without waiting for the next seen broadcast.
  const lastSeenEventRef = useRef(null);

  // Shared helper: apply a seen/read timestamp to the current conversation's
  // message cache. Extracted at hook scope so sendMessageOptimistically can
  // call it after a slow ACK without a stale closure on the socket effect.
  const applySeenToCache = useCallback((lastReadAt) => {
    const lastReadTime = new Date(lastReadAt).getTime();
    queryClient.setQueryData(['messages', activeChatId], (oldData) => {
      if (!oldData?.pages) return oldData;
      let hasChanges = false;
      const newPages = oldData.pages.map((page) => {
        if (!page.messages) return page;
        const newMessages = page.messages.map((msg) => {
          const isMyMsg = checkIsMe(msg, currentUser);
          // Skip optimistic ('sending') and failed messages — they have no
          // real server timestamp and a failed message must never become 'read'.
          if (isMyMsg && msg.status !== 'read' && msg.status !== 'sending' && msg.status !== 'failed') {
            const msgTime = new Date(msg.createdAt).getTime();
            if (!isNaN(msgTime) && msgTime <= lastReadTime) {
              hasChanges = true;
              idbPatchMessage(activeChatId, msg.id || msg.tempId, { status: 'read' });
              return { ...msg, status: 'read' };
            }
          }
          return msg;
        });
        return { ...page, messages: newMessages };
      });
      return hasChanges ? { ...oldData, pages: newPages } : oldData;
    });
  }, [activeChatId, currentUser?.id, queryClient]);

  const clearActiveChatUnread = useCallback((force = false) => {
    if (!activeChatId) return;

    // Skip if already marked for this chat (guards against duplicate HTTP + socket fire)
    if (!force && lastMarkedReadRef.current === activeChatId) {
      return;
    }

    lastMarkedReadRef.current = activeChatId;

    queryClient.setQueryData(['conversations'], (oldConvs) => {
      if (!Array.isArray(oldConvs)) return oldConvs;
      let modified = false;

      const updated = oldConvs.map((c) => {
        const isMatch = String(c.id) === String(activeChatId) ||
          String(c.publicId) === String(activeChatId) ||
          String(c.internalId) === String(activeChatId);

        if (isMatch && ((c.unreadCount || 0) > 0 || (c.unread || 0) > 0)) {
          modified = true;
          return { ...c, unreadCount: 0, unread: 0 };
        }
        return c;
      });

      return modified ? updated : oldConvs;
    });

    // Single authoritative path: socket if connected, HTTP fallback only if not.
    // Never fire both — the backend writes on either event.
    if (socket?.connected) {
      socket.emit('conversation:mark_seen', { conversationId: activeChatId });
    } else {
      messagesApi.markAsRead(activeChatId).catch(() => {});
    }
  }, [activeChatId, queryClient, socket]);

  useEffect(() => {
    // Clear any pending debounce from the previous chat before marking new one read
    if (markReadDebounceRef.current) {
      clearTimeout(markReadDebounceRef.current);
      markReadDebounceRef.current = null;
    }
    lastMarkedReadRef.current = null;
    clearActiveChatUnread(true);
  }, [activeChatId]);

  // Seen evaluator: debounced 800ms to avoid repeated calls during scroll/focus events
  const markSeenIfEligible = useCallback((isNearBottom = true) => {
    isNearBottomRef.current = isNearBottom;

    if (!activeChatId) return;
    if (typeof document === 'undefined') return;

    const isVisible = document.visibilityState === 'visible';
    const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

    if (isVisible && hasFocus && isNearBottom) {
      // Debounce — collapse rapid scroll/focus events into one network call per conversation
      if (markReadDebounceRef.current) clearTimeout(markReadDebounceRef.current);
      markReadDebounceRef.current = setTimeout(() => {
        clearActiveChatUnread();
        // messages:seen is the detailed per-message event; conversation:mark_seen is handled
        // inside clearActiveChatUnread, so we only emit the one extra messages:seen here.
        if (socket?.connected) {
          const lastMsg = allMessages[allMessages.length - 1];
          if (lastMsg?.id) {
            socket.emit('messages:seen', {
              conversationId: activeChatId,
              lastMessageId: lastMsg.id,
            });
          }
        }
      }, 800);
    }
  }, [socket, activeChatId, allMessages, clearActiveChatUnread]);

  // Listen for window focus & tab visibility changes
  useEffect(() => {
    if (!activeChatId) return;

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
  }, [activeChatId, markSeenIfEligible]);

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

    const clientId = options?.clientId || options?.tempId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    const tempId = clientId;

    // The caller (ChatInputArea) passes an object-URL preview as mediaUrl alongside
    // fileObj — capture it so the bubble can paint instantly and we can revoke it
    // once the server asset has loaded (prevents the memory leak + flicker).
    const localPreviewUrl = fileObj && typeof mediaUrl === 'string' && mediaUrl.startsWith('blob:') ? mediaUrl : null;
    // Pre-seed dims from a caller-provided value if any; refined async below.
    const initialWidth = options?.width || null;
    const initialHeight = options?.height || null;

    const tempMessage = {
      id: tempId,
      tempId,
      clientId,
      conversationId: targetConvId,
      senderId: currentUser?.id || 'me',
      sender: currentUser || { id: 'me' },
      from: 'me',
      text: payloadText,
      payload: {
        text: payloadText,
        mediaUrl,
        thumbnailUrl: fileObj ? localPreviewUrl : (options?.thumbnailUrl || null),
        localPreviewUrl,
        mediaType,
        width: initialWidth,
        height: initialHeight,
        duration: options?.duration || null,
        mentions,
        inviteData: explicitInviteData,
        clientId,
        tempId,
      },
      mediaType,
      uploadStatus: fileObj ? 'uploading' : undefined,
      uploadProgress: fileObj ? 0 : undefined,
      replyTo,
      status: 'sending',
      createdAt: new Date().toISOString(),
    };

    appendMessageToCache(queryClient, targetConvId, tempMessage);
    const previewSnippet = payloadText || (explicitInviteData ? (explicitInviteData.groupName ? `Group invite: ${explicitInviteData.groupName}` : 'Group invite') : mediaType ? (mediaType === 'image' ? 'Photo' : mediaType === 'video' ? 'Video' : 'Audio') : mediaUrl ? 'Media' : '');
    updateConversationPreview(queryClient, targetConvId, previewSnippet, tempMessage.createdAt, 0);
    idbSaveMessages(targetConvId, [tempMessage]);

    let finalMediaUrl = mediaUrl;
    let finalThumbnailUrl = tempMessage.payload.thumbnailUrl;
    let finalWidth = initialWidth;
    let finalHeight = initialHeight;
    let finalDuration = tempMessage.payload.duration;

    if (fileObj) {
      const file = fileObj;
      const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      // Remember everything needed to retry/cancel this upload by clientId.
      pendingUploadsRef.current.set(clientId, {
        file, mediaType, targetConvId, localPreviewUrl, abortController,
        sendArgs: { convId: targetConvId, text: payloadText, replyTo, mentions, mediaUrl, mediaType, explicitInviteData },
      });

      // Refine image dimensions off the main thread and reserve layout space early.
      if (file.type?.startsWith('image/') && (!finalWidth || !finalHeight)) {
        getImageDimensions(file).then((dims) => {
          if (dims?.width && dims?.height) {
            finalWidth = dims.width;
            finalHeight = dims.height;
            updateMessageInCache(queryClient, targetConvId, clientId, (existing) => ({
              payload: { ...(existing?.payload || {}), width: dims.width, height: dims.height },
            }));
          }
        }).catch(() => {});
      }

      // Throttled progress writer — updates ONLY this message's uploadProgress.
      const onProgress = makeProgressThrottle((percent) => {
        updateMessageInCache(queryClient, targetConvId, clientId, { uploadProgress: percent });
      }, 150);

      try {
        let uploadRes;
        if (file.type?.startsWith('image/')) {
          uploadRes = await processAndUploadImage(file, 'chat', {}, onProgress, abortController?.signal);
        } else if (file.type?.startsWith('video/')) {
          uploadRes = await processAndUploadVideo(file, 'chat', onProgress, abortController?.signal);
        } else {
          uploadRes = await uploadFileDirect(file, 'chat', onProgress, abortController?.signal);
        }

        if (uploadRes?.publicUrl) {
          finalMediaUrl = uploadRes.publicUrl;
          finalThumbnailUrl = uploadRes.thumbnailUrl || uploadRes.publicUrl;
          finalWidth = uploadRes.width || finalWidth;
          finalHeight = uploadRes.height || finalHeight;
          finalDuration = uploadRes.duration || finalDuration;

          updateMessageInCache(queryClient, targetConvId, clientId, (existing) => ({
            mediaUrl: finalMediaUrl,
            uploadStatus: 'done',
            uploadProgress: 100,
            payload: {
              ...(existing?.payload || {}),
              mediaUrl: finalMediaUrl,
              thumbnailUrl: finalThumbnailUrl,
              width: finalWidth,
              height: finalHeight,
              duration: finalDuration,
            },
          }));
          idbPatchMessage(targetConvId, clientId, {
            mediaUrl: finalMediaUrl,
            uploadStatus: 'done',
            payload: { ...tempMessage.payload, mediaUrl: finalMediaUrl, thumbnailUrl: finalThumbnailUrl, width: finalWidth, height: finalHeight, duration: finalDuration },
          }).catch(() => {});
        }

        pendingUploadsRef.current.delete(clientId);
        // Revoke the local preview shortly after the server thumbnail has had time
        // to load — avoids both the memory leak and a mid-load flash.
        if (localPreviewUrl) setTimeout(() => { try { URL.revokeObjectURL(localPreviewUrl); } catch (_) {} }, 5000);
      } catch (err) {
        // A deliberate cancel removes the message; a real failure keeps it retryable.
        if (err?.name === 'AbortError') {
          pendingUploadsRef.current.delete(clientId);
          if (localPreviewUrl) { try { URL.revokeObjectURL(localPreviewUrl); } catch (_) {} }
          return;
        }
        updateMessageInCache(queryClient, targetConvId, clientId, { status: 'failed', uploadStatus: 'failed' });
        idbPatchMessage(targetConvId, clientId, { status: 'failed', uploadStatus: 'failed' }).catch(() => {});
        return;
      }
    }

    const payload = {
      tempId: clientId,
      clientId,
      conversationId: targetConvId,
      text: payloadText,
      mediaUrl: (finalMediaUrl && !String(finalMediaUrl).startsWith('blob:')) ? finalMediaUrl : undefined,
      thumbnailUrl: (finalThumbnailUrl && !String(finalThumbnailUrl).startsWith('blob:')) ? finalThumbnailUrl : undefined,
      mediaType,
      width: finalWidth || undefined,
      height: finalHeight || undefined,
      duration: finalDuration || undefined,
      mentions,
      replyToId: replyTo?.id,
      inviteData: explicitInviteData,
    };

    let sendHandled = false;

    const handleSuccess = (serverMsg) => {
      if (sendHandled) return;
      sendHandled = true;
      updateMessageInCache(queryClient, targetConvId, clientId, (existing) => {
        const finalStatus = (existing?.status === 'read' || existing?.status === 'seen') ? existing.status : 'sent';
        // Merge payloads so locally-derived media metadata (thumbnailUrl, width,
        // height, duration) survives even if the server ACK omits them. Server
        // values win when present; local preview URLs are dropped in favour of
        // the confirmed server mediaUrl.
        const mergedPayload = {
          ...(existing?.payload || {}),
          ...(serverMsg?.payload || {}),
          thumbnailUrl: serverMsg?.payload?.thumbnailUrl || serverMsg?.thumbnailUrl || finalThumbnailUrl || existing?.payload?.thumbnailUrl,
          width: serverMsg?.payload?.width || finalWidth || existing?.payload?.width,
          height: serverMsg?.payload?.height || finalHeight || existing?.payload?.height,
          duration: serverMsg?.payload?.duration || finalDuration || existing?.payload?.duration,
          localPreviewUrl: undefined,
        };
        const updated = {
          ...existing,
          ...(serverMsg || {}),
          id: serverMsg?.id || existing?.id || clientId,
          clientId,
          tempId: clientId,
          status: finalStatus,
          uploadStatus: fileObj ? 'done' : existing?.uploadStatus,
          mediaUrl: serverMsg?.mediaUrl || finalMediaUrl || existing?.mediaUrl,
          payload: mergedPayload,
        };
        idbPatchMessage(targetConvId, updated.id, updated).catch(console.warn);
        return updated;
      });
      if (activeChatId && activeChatId !== targetConvId) {
        updateMessageInCache(queryClient, activeChatId, clientId, { status: 'sent' });
      }
    };

    const handleFailure = () => {
      if (sendHandled) return;
      sendHandled = true;
      updateMessageInCache(queryClient, targetConvId, clientId, { status: 'failed' });
      if (activeChatId && activeChatId !== targetConvId) {
        updateMessageInCache(queryClient, activeChatId, clientId, { status: 'failed' });
      }
      idbPatchMessage(targetConvId, clientId, { status: 'failed' }).catch(console.warn);
    };

    if (socket?.connected) {
      let ackReceived = false;
      const timeoutTimer = setTimeout(async () => {
        if (!ackReceived && !sendHandled) {
          try {
            const res = await getApi().sendMessage(targetConvId, payload);
            if (res) {
              handleSuccess(res);
            } else {
              handleFailure();
            }
          } catch (e) {
            handleFailure();
          }
        }
      }, 5000);

      socket.emit('message:send', payload, (response) => {
        ackReceived = true;
        clearTimeout(timeoutTimer);
        if (response?.status === 'ok') {
          handleSuccess(response.message);
        } else {
          handleFailure();
        }
      });
    } else {
      try {
        const res = await getApi().sendMessage(targetConvId, payload);
        if (res) {
          handleSuccess(res);
        } else {
          handleFailure();
        }
      } catch (err) {
        handleFailure();
      }
    }
  }, [activeChatId, currentUser, queryClient, socket, applySeenToCache]);

  // Retry a failed media upload with the SAME clientId — appendMessageToCache
  // matches by clientId and updates in place, so no duplicate message/record.
  const retryUpload = useCallback((clientId) => {
    if (!clientId) return;
    const entry = pendingUploadsRef.current.get(clientId);
    // Even if the entry was cleared, the failed message row still holds the File
    // reference via the pending map; if absent we cannot retry (page was reloaded).
    if (!entry?.file) return;
    const a = entry.sendArgs || {};
    updateMessageInCache(queryClient, entry.targetConvId, clientId, { status: 'sending', uploadStatus: 'uploading', uploadProgress: 0 });
    sendMessageOptimistically({
      conversationId: entry.targetConvId,
      text: a.text || '',
      replyTo: a.replyTo,
      mentions: a.mentions || [],
      mediaUrl: entry.localPreviewUrl || a.mediaUrl,
      mediaType: entry.mediaType,
      inviteData: a.explicitInviteData,
      fileObj: entry.file,
      clientId,
      tempId: clientId,
    });
  }, [queryClient, sendMessageOptimistically]);

  // Cancel an in-flight upload — aborts the XHR and removes the optimistic row.
  const cancelUpload = useCallback((clientId) => {
    if (!clientId) return;
    const entry = pendingUploadsRef.current.get(clientId);
    if (entry?.abortController) { try { entry.abortController.abort(); } catch (_) {} }
    pendingUploadsRef.current.delete(clientId);
    if (entry?.localPreviewUrl) { try { URL.revokeObjectURL(entry.localPreviewUrl); } catch (_) {} }
    // Remove the optimistic message from cache + IDB.
    queryClient.setQueryData(['messages', entry?.targetConvId || activeChatId], (old) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          messages: (page.messages || []).filter((m) => m.clientId !== clientId && m.tempId !== clientId && m.id !== clientId),
        })),
      };
    });
    idbDeleteMessage(clientId).catch(() => {});
  }, [queryClient, activeChatId]);

  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Socket sync & Room Management
  useEffect(() => {
    if (!socket || !activeChatId) return;

    const matchedConv = conversationsRef.current?.find((c) => matchesConversationId(c, activeChatId));

    const aliases = getConversationAliases(matchedConv);
    const allCandidateIds = Array.from(
      new Set([activeChatId, ...aliases].filter(Boolean))
    );

    const joinRooms = () => {
      socket.emit('conversation:join_rooms', { conversationIds: allCandidateIds });
      markSeenIfEligible(isNearBottomRef.current);
    };

    joinRooms();
    socket.on('connect', joinRooms);

    // isMatch only tests conversation-level identifiers (not participant user-IDs).
    // Participant IDs were removed from allCandidateIds / getConversationAliases so
    // messages never leak into unrelated conversations sharing those participants.
    const isMatch = (receivedId, msgObj) => {
      if (receivedId && allCandidateIds.some((id) => String(id) === String(receivedId))) return true;
      if (msgObj) {
        // Only check the canonical conversation fields — never userId-level fields
        const keys = [msgObj.conversationId, msgObj.publicId, msgObj.internalId].filter(Boolean);
        return keys.some((k) => allCandidateIds.some((id) => String(id) === String(k)));
      }
      return false;
    };

    // Single authoritative message:new handler for this conversation.
    const handleIncomingNewMessage = (payload) => {
      const msg = payload?.message || payload;
      const convId = payload?.conversationId || msg?.conversationId;
      if (!isMatch(convId, msg) || !msg) return;

      const isMyMsg = checkIsMe(msg, currentUser);

      // Only write to conversation-level cache keys — never to participant user-ID
      // keys that happened to be in allCandidateIds (already stripped there).
      const keysToUpdate = Array.from(
        new Set(
          [
            activeChatId,
            convId,
            msg.conversationId,
            msg.publicId,
            msg.internalId,
          ].filter(Boolean)
        )
      );

      keysToUpdate.forEach((key) => {
        appendMessageToCache(queryClient, key, msg);
        idbSaveMessages(key, [msg]).catch(console.warn);
      });

      updateConversationPreview(
        queryClient,
        convId || activeChatId,
        msg.text || msg.payload?.text,
        msg.createdAt,
        0
      );

      if (!isMyMsg) {
        if (msg.id && socket?.connected) {
          socket.emit('message:delivered', {
            conversationId: activeChatId,
            messageId: msg.id,
          });
        }
        markSeenIfEligible(isNearBottomRef.current);
      }
    };

    // Delivery ACK: update our sent message to 'delivered'
    const handleMessageDelivered = (payload) => {
      if (!payload || !isMatch(payload.conversationId)) return;
      const targetId = payload.messageId;

      queryClient.setQueryData(['messages', activeChatId], (oldData) => {
        if (!oldData?.pages) return oldData;
        let hasChanges = false;
        const newPages = oldData.pages.map((page) => {
          if (!page.messages) return page;
          const newMessages = page.messages.map((msg) => {
            if (
              (msg.id === targetId || msg.tempId === targetId || msg.clientId === targetId) &&
              msg.status !== 'read' &&
              msg.status !== 'seen'
            ) {
              hasChanges = true;
              idbPatchMessage(activeChatId, msg.id || msg.tempId, { status: 'delivered' });
              return { ...msg, status: 'delivered' };
            }
            return msg;
          });
          return { ...page, messages: newMessages };
        });
        return hasChanges ? { ...oldData, pages: newPages } : oldData;
      });
    };

    // Seen ACK: mark all my confirmed sent messages as read.
    // NEVER runs on 'sending' — those haven't been confirmed by the server yet.
    // applySeenToCache is defined at hook scope (not here) so the socket ACK
    // callbacks in sendMessageOptimistically can also call it without a stale closure.
    const handleConversationSeen = (data) => {
      const isTargetMatch = isMatch(data?.conversationId) || isMatch(data?.realConvId);
      const isRecipientReader =
        !data?.readerId || String(data.readerId) !== String(currentUser?.id);

      if (!isTargetMatch || !isRecipientReader || !data?.lastReadAt) return;

      // Store for late-ACK back-application
      lastSeenEventRef.current = { conversationId: activeChatId, lastReadAt: data.lastReadAt };
      applySeenToCache(data.lastReadAt);
    };

    // Message update (unsend, edit, etc.) broadcast handler
    const handleMessageUpdated = (payload) => {
      const msgId = payload?.id || payload?.messageId;
      const convId = payload?.conversationId || payload?.publicId || payload?.internalId;
      if (!msgId || !isMatch(convId, payload)) return;

      const isUnsent = payload.state === 'UNSENT' || payload.isUnsent;

      const patch = {
        state: payload.state || 'UNSENT',
        isUnsent,
        text: isUnsent ? 'This message was unsent' : (payload.text || ''),
        payload: isUnsent ? { text: 'This message was unsent' } : (payload.payload || { text: payload.text }),
        mediaUrl: isUnsent ? null : (payload.mediaUrl || null),
        mediaType: isUnsent ? null : (payload.mediaType || null),
        inviteData: isUnsent ? null : (payload.inviteData || null),
        replyTo: isUnsent ? null : (payload.replyTo || null),
      };

      // Update cache and IDB across all candidate conversation keys (activeChatId, publicId, internalId)
      allCandidateIds.forEach((key) => {
        updateMessageInCache(queryClient, key, msgId, patch);
        idbPatchMessage(key, msgId, patch).catch(console.warn);
      });

      if (isUnsent) {
        allCandidateIds.forEach((key) => {
          updateConversationPreview(queryClient, key, 'This message was unsent');
        });
      }
    };

    socket.on('message:new', handleIncomingNewMessage);
    socket.on('message:delivered', handleMessageDelivered);
    socket.on('message:updated', handleMessageUpdated);
    socket.on('messages:seen', handleConversationSeen);
    socket.on('conversation:seen', handleConversationSeen);

    return () => {
      socket.off('connect', joinRooms);
      socket.off('message:new', handleIncomingNewMessage);
      socket.off('message:delivered', handleMessageDelivered);
      socket.off('message:updated', handleMessageUpdated);
      socket.off('messages:seen', handleConversationSeen);
      socket.off('conversation:seen', handleConversationSeen);
    };
  }, [socket, activeChatId, queryClient, currentUser, markSeenIfEligible, applySeenToCache]);

  return {
    messages: allMessages,
    rawPages: historyPages?.pages,
    isLoading: isLoadingMessages,
    // True once the server has authoritatively rejected this conversation id
    // (doesn't exist, or the current user isn't a participant — the backend
    // collapses both into the same 403 so this signal never distinguishes them).
    isError,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    onLoadMore: fetchNextPage,
    sendMessageOptimistically,
    retryUpload,
    cancelUpload,
    markSeenIfEligible,
  };
}

