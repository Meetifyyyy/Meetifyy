import { useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ErrorState } from '@shared/components/ui/StateViews';
import Avatar from '@shared/components/avatar/Avatar';
import MessageBubble from './MessageBubble';
import { timeAgo } from '@shared/utils/time';
import styles from './ChatMessageList.module.css';
import { getMsgTimestamp, compareMessages } from '../utils/cacheUtils';


const getRelativeDateString = (date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const msgDate = new Date(date);
  msgDate.setHours(0, 0, 0, 0);
  
  const diffTime = today.getTime() - msgDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return msgDate.toLocaleDateString(undefined, { weekday: 'long' });
  } else {
    return msgDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
};

const getMessageDateGroup = (msg) => {
  const rawDate = msg.createdAt || msg.timestamp;
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      return getRelativeDateString(d);
    }
  }
  
  const time = msg.time || '';
  const clean = time.toLowerCase().trim();
  
  if (clean.includes('yesterday')) {
    return 'Yesterday';
  }
  if (clean === '1d ago') {
    return 'Yesterday';
  }
  if (clean.includes('2d ago')) {
    const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  if (clean.includes('3d ago') || clean.includes('4d ago') || clean.includes('5d ago') || clean.includes('6d ago') || clean.includes('7d ago')) {
    const match = clean.match(/(\d+)d\s+ago/);
    if (match) {
      const days = parseInt(match[1], 10);
      const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    }
  }
  if (clean.includes('ago') || clean.includes('am') || clean.includes('pm') || clean.match(/^\d{1,2}:\d{2}$/)) {
    return 'Today';
  }
  
  return 'Today';
};

const dateGroupCache = new Map();
const getMessageDateGroupMemoized = (msg) => {
  const rawKey = msg.id || msg.clientId || msg.tempId || msg.createdAt || msg.timestamp;
  if (rawKey && dateGroupCache.has(rawKey)) {
    return dateGroupCache.get(rawKey);
  }
  const result = getMessageDateGroup(msg);
  if (rawKey) {
    dateGroupCache.set(rawKey, result);
    if (dateGroupCache.size > 5000) {
      const firstKey = dateGroupCache.keys().next().value;
      dateGroupCache.delete(firstKey);
    }
  }
  return result;
};

export default function ChatMessageList({
  isLoading,
  error,
  retry,
  messages = [],
  conversation,
  currentUser,
  users,
  initial,
  searchQuery,
  openViewer,
  onOpenMediaModal,
  onReply,
  onReplyTo,
  onUnsend,
  isTyping,
  replyingTo,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onContextMenu,
  onOpenContextMenu,
  typingUsers,
  onMarkSeen
}) {
  const bodyRef = useRef(null);
  const virtualInnerRef = useRef(null);

  const prevConvIdRef = useRef(conversation?.id);
  const prevMessagesCountRef = useRef(messages?.length || 0);
  const prevFirstMsgIdRef = useRef(messages?.[0]?.id);
  const prevScrollHeightRef = useRef(0);

  // Post-render evaluation: mark seen with debouncing to prevent excessive API calls
  useEffect(() => {
    if (!isLoading && !error && messages && messages.length > 0 && onMarkSeen) {
      const timer = setTimeout(() => {
        const isNearBottom = bodyRef.current
          ? (bodyRef.current.scrollHeight - bodyRef.current.scrollTop - bodyRef.current.clientHeight) < 150
          : true;
        onMarkSeen(isNearBottom);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [messages?.length, isLoading, error, onMarkSeen]);

  // Resolve typing user avatar & display name from users, conversation participants, or otherUser
  const firstTypingEntry = typingUsers?.size > 0 ? typingUsers.entries().next().value : null;
  const firstTypingUserId = firstTypingEntry?.[0];
  const firstTypingUserName = firstTypingEntry?.[1];

  const typingUserObj = firstTypingUserId ? (users?.[firstTypingUserId] || users?.[String(firstTypingUserId)]) : null;
  const typingParticipant = firstTypingUserId
    ? (conversation?.participants?.find(p => String(p.id || p.userId || p._id) === String(firstTypingUserId)) ||
       conversation?.members?.find(p => String(p.id || p.userId || p._id) === String(firstTypingUserId)))
    : null;

  const typingAvatar = typingUserObj?.avatar || typingUserObj?.profileImage || typingUserObj?.avatarUrl ||
                       typingParticipant?.avatar || typingParticipant?.profileImage || typingParticipant?.avatarUrl ||
                       conversation?.otherUser?.avatar || conversation?.otherUser?.profileImage || conversation?.avatar || null;

  const typingName = typingUserObj?.displayName || typingUserObj?.name || typingUserObj?.username ||
                     firstTypingUserName || typingParticipant?.displayName || typingParticipant?.name ||
                     conversation?.otherUser?.displayName || conversation?.otherUser?.name || conversation?.name || '';

  const itemsToRender = useMemo(() => {
    const items = [];
    if (!messages || messages.length === 0) {
      if (isTyping) {
        items.push({
          type: 'typing_indicator',
          id: 'item_typing_indicator'
        });
      }
      return items;
    }

    if (hasMore) {
      items.push({
        type: 'load_more',
        id: 'item_load_more'
      });
    }

    if (conversation?.isInstantMatch) {
      items.push({
        type: 'instant_match_banner',
        id: 'item_instant_match_banner'
      });
    }

    const isGroupUpdatesActive = conversation?.groupUpdatesActive !== false;

    // Deduplicate loadedMessages by message ID / tempId to prevent key collision warnings and consecutive duplicate system messages
    const seenMsgIds = new Set();
    let lastSystemText = null;
    const filteredMessages = (messages || []).filter((msg, idx) => {
      const isSystem = msg.type === 'system' || msg.type === 'SYSTEM' || msg.isSystem;
      if (!isGroupUpdatesActive && isSystem) {
        return false;
      }
      const text = (msg.text || msg.payload?.text || '').trim();
      if (isSystem) {
        if (text && text === lastSystemText) {
          return false;
        }
        lastSystemText = text;
      } else {
        lastSystemText = null;
      }
      const keyId = msg.id || msg.clientId || msg.tempId || `temp_idx_${idx}`;
      if (seenMsgIds.has(keyId)) {
        return false;
      }
      seenMsgIds.add(keyId);
      return true;
    });

    const sortedMessages = [...filteredMessages].sort(compareMessages);

    let lastDateGroup = null;
    sortedMessages.forEach((msg, i) => {
      const dateGroup = getMessageDateGroupMemoized(msg);
      const stableKey = msg.id || msg.clientId || msg.tempId || `idx_${i}`;
      if (dateGroup !== lastDateGroup) {
        items.push({
          type: 'date_separator',
          id: `date_sep_${dateGroup}_${stableKey}`,
          dateGroup
        });
        lastDateGroup = dateGroup;
      }
      items.push({
        type: 'message',
        id: `msg_${stableKey}`,
        msg,
        index: i,
        isLatestMessage: i === sortedMessages.length - 1
      });
    });

    if (isTyping) {
      items.push({
        type: 'typing_indicator',
        id: 'item_typing_indicator'
      });
    }

    return items;
  }, [messages, conversation?.groupUpdatesActive, conversation?.isInstantMatch, hasMore, isTyping]);

  const rowVirtualizer = useVirtualizer({
    count: itemsToRender.length,
    getScrollElement: () => bodyRef.current,
    getItemKey: (index) => itemsToRender[index].id,
    estimateSize: (index) => {
      const item = itemsToRender[index];
      if (item?.type === 'typing_indicator') return 52;
      if (item?.type === 'load_more') return 52;
      if (item?.type === 'instant_match_banner') return 44;
      if (item?.type === 'date_separator') return 36;
      if (item?.msg?.mediaUrl) return 240;
      if (item?.msg?.type === 'system' || item?.msg?.type === 'SYSTEM') return 40;
      return 68;
    },
    overscan: 8,
  });

  const totalSize = rowVirtualizer.getTotalSize();
  const hasScrolledInitialRef = useRef(false);

  useEffect(() => {
    hasScrolledInitialRef.current = false;
  }, [conversation?.id, conversation?.publicId, conversation?.internalId]);

  const scrollToBottom = useCallback(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight + 10000;
      prevScrollHeightRef.current = bodyRef.current.scrollHeight;
    }
    if (itemsToRender.length > 0) {
      try {
        rowVirtualizer.scrollToIndex(itemsToRender.length - 1, { align: 'end' });
      } catch (_) {}
    }
  }, [itemsToRender.length, rowVirtualizer]);

  useLayoutEffect(() => {
    if (!bodyRef.current || !messages) return;

    const currentConvId = conversation?.id || conversation?.publicId;
    const currentCount = messages.length;
    const firstMsgId = messages[0]?.id;
    const prevFirstMsgId = prevFirstMsgIdRef.current;
    const prevCount = prevMessagesCountRef.current;

    // SCENARIO 1: First time messages are available for this conversation load
    if (!hasScrolledInitialRef.current && currentCount > 0) {
      hasScrolledInitialRef.current = true;
      prevConvIdRef.current = currentConvId;
      prevFirstMsgIdRef.current = firstMsgId;
      prevMessagesCountRef.current = currentCount;

      scrollToBottom();

      const raf1 = requestAnimationFrame(() => scrollToBottom());
      const raf2 = requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom()));
      const t1 = setTimeout(scrollToBottom, 40);
      const t2 = setTimeout(scrollToBottom, 120);
      const t3 = setTimeout(scrollToBottom, 300);

      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    const isPrepend = firstMsgId && prevFirstMsgId && firstMsgId !== prevFirstMsgId && currentCount > prevCount;

    // SCENARIO 2: Prepend (Loading older history)
    if (isPrepend) {
      requestAnimationFrame(() => {
        if (bodyRef.current) {
          const newScrollHeight = bodyRef.current.scrollHeight;
          const diff = newScrollHeight - prevScrollHeightRef.current;
          bodyRef.current.scrollTop += diff;
          prevScrollHeightRef.current = newScrollHeight;
        }
      });
    } else if (currentCount > prevCount) {
      // SCENARIO 3: Append (New message sent or received)
      const lastMsg = messages[messages.length - 1];
      const isFromMe = lastMsg?.from === 'me' || String(lastMsg?.senderId) === String(currentUser?.id);
      const isNearBottom = (bodyRef.current.scrollHeight - bodyRef.current.scrollTop - bodyRef.current.clientHeight) < 180;

      if (isFromMe || isNearBottom) {
        scrollToBottom();
        requestAnimationFrame(() => {
          scrollToBottom();
          setTimeout(scrollToBottom, 50);
        });
      }
    }

    prevFirstMsgIdRef.current = firstMsgId;
    prevMessagesCountRef.current = currentCount;
    if (bodyRef.current) {
      prevScrollHeightRef.current = bodyRef.current.scrollHeight;
    }
  }, [messages, conversation?.id, conversation?.publicId, currentUser?.id, replyingTo, scrollToBottom]);

  // Adjust scroll as virtualizer measures elements on initial load
  useLayoutEffect(() => {
    if (bodyRef.current && totalSize > 0) {
      if (!hasScrolledInitialRef.current) {
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight + 10000;
      } else {
        const isNearBottom = (bodyRef.current.scrollHeight - bodyRef.current.scrollTop - bodyRef.current.clientHeight) < 180;
        if (isNearBottom) {
          bodyRef.current.scrollTop = bodyRef.current.scrollHeight + 10000;
        }
      }
    }
  }, [totalSize]);

  const handleScroll = () => {
    if (!bodyRef.current) return;
    
    if (!hasMore || isLoadingMore || isLoading) return;
    
    // Scrolling up towards older messages
    const isNearTop = bodyRef.current.scrollTop < 350;
    
    if (isNearTop) {
      if (onLoadMore) onLoadMore();
    }
  };

  // Trigger load when load_more virtual item comes into view
  useEffect(() => {
    if (hasMore && !isLoadingMore && !isLoading) {
      const hasLoadMoreVisible = rowVirtualizer.getVirtualItems().some(v => itemsToRender[v.index]?.type === 'load_more');
      if (hasLoadMoreVisible) {
        if (onLoadMore) onLoadMore();
      }
    }
  }, [rowVirtualizer.getVirtualItems(), hasMore, isLoadingMore, isLoading, onLoadMore, itemsToRender]);

  return (
    <div className={styles.msgChatBody} ref={bodyRef} onScroll={handleScroll}>
      {/* VISUALLY BOTTOM */}

      {!isLoading && !error && itemsToRender.length > 0 && (
        <div
          ref={virtualInnerRef}
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const item = itemsToRender[virtualItem.index];
            if (!item) return null;

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  paddingBottom: '0.5rem',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {item.type === 'load_more' && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '0.85rem 0' }}>
                    <div 
                      className="spinner" 
                      style={{ 
                        width: '18px', 
                        height: '18px', 
                        borderWidth: '2.5px', 
                        borderStyle: 'solid',
                        borderColor: 'var(--color-primary, #3b82f6) transparent transparent transparent',
                        borderRadius: '50%',
                        animation: 'spin 0.75s linear infinite'
                      }} 
                    />
                    <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text-secondary, #9ca3af)', letterSpacing: '0.02em' }}>
                      Loading older messages…
                    </span>
                  </div>
                )}

                {item.type === 'instant_match_banner' && (
                  <div className={styles.msgDateSeparator} style={{ margin: '0.5rem 0' }}>
                    <span className={styles.msgDateSeparatorLine}></span>
                    <span className={styles.msgDateSeparatorText} style={{ background: 'rgba(234, 179, 8, 0.12)', color: '#eab308', padding: '4px 14px', borderRadius: '14px', fontWeight: 600, fontSize: '0.78rem' }}>
                      ⚡ Instant Match started {conversation.createdAt ? timeAgo(conversation.createdAt) : 'recently'}
                    </span>
                    <span className={styles.msgDateSeparatorLine}></span>
                  </div>
                )}

                {item.type === 'date_separator' && (
                  <div className={styles.msgDateSeparator}>
                    <span className={styles.msgDateSeparatorLine}></span>
                    <span className={styles.msgDateSeparatorText}>{item.dateGroup}</span>
                    <span className={styles.msgDateSeparatorLine}></span>
                  </div>
                )}

                {item.type === 'message' && (
                  <MessageBubble
                    index={item.index}
                    isLatestMessage={item.isLatestMessage}
                    onUnsend={onUnsend}
                    msg={item.msg}
                    conversation={conversation}
                    currentUser={currentUser}
                    users={users}
                    initial={initial}
                    searchQuery={searchQuery}
                    onReply={onReply}
                    onReplyTo={onReplyTo || onReply}
                    onContextMenu={onContextMenu || onOpenContextMenu}
                    onOpenContextMenu={onOpenContextMenu}
                    onOpenMediaModal={onOpenMediaModal || openViewer}
                  />
                )}

                {item.type === 'typing_indicator' && (
                  <div className={`${styles.msgBubbleContainer} ${styles.msgBubbleContainerThem}`}>
                    <div className={styles.msgBubbleWrapper}>
                      <div className={styles.msgAvatar}>
                        <Avatar src={typingAvatar} name={typingName} size="28px" />
                      </div>
                      <div className={styles.msgBubbleContent}>
                        {(conversation?.isGroup || conversation?.type === 'GROUP' || conversation?.type === 'ACTIVITY') && typingName && (
                          <span className={styles.msgSenderName}>{typingName}</span>
                        )}
                        <div className={`${styles.msgMainRow} ${styles.msgMainRowThem}`}>
                          <div className={`${styles.msgBubble} ${styles.msgBubbleThem}`} style={{ display: 'inline-flex', alignItems: 'center', padding: '0.65rem 0.95rem' }}>
                            <div className={styles.typingBubbleInline}>
                              <span className={styles.typingDot} />
                              <span className={styles.typingDot} />
                              <span className={styles.typingDot} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && !error && itemsToRender.length === 0 && (
        <div className={styles.msgEmptyState}>No messages in this chat.</div>
      )}

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem', flex: 1 }}>
          <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '3px', borderTopColor: 'var(--color-primary)' }}></div>
        </div>
      )}

      {!isLoading && error && (
        <div>
          <ErrorState onRetry={retry} />
        </div>
      )}
    </div>
  );
}
