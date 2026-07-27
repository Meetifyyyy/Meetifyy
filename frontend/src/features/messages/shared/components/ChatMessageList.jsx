import { useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ErrorState } from '@shared/components/ui/StateViews';
import MessageBubble from './MessageBubble';
import { timeAgo } from '@shared/utils/time';
import styles from './ChatMessageList.module.css';

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
  if (msg.timestamp) {
    return getRelativeDateString(new Date(msg.timestamp));
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
  onReply,
  onReplyTo,
  onRetryMessage,
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

  // Post-render evaluation: mark seen only after message elements have rendered in DOM
  useEffect(() => {
    if (!isLoading && !error && messages && messages.length > 0 && onMarkSeen) {
      const isNearBottom = bodyRef.current ? bodyRef.current.scrollTop < 150 : true;
      onMarkSeen(isNearBottom);
    }
  }, [messages, isLoading, error, onMarkSeen]);

  const itemsToRender = useMemo(() => {
    const items = [];
    if (!messages || messages.length === 0) {
      return items;
    }

    if (conversation?.isInstantMatch) {
      items.push({
        type: 'instant_match_banner',
        id: 'item_instant_match_banner'
      });
    }

    if (hasMore) {
      items.push({
        type: 'load_more',
        id: 'item_load_more'
      });
    }

    const isGroupUpdatesActive = conversation?.groupUpdatesActive !== false;

    // Deduplicate loadedMessages by message ID / tempId to prevent key collision warnings
    const seenMsgIds = new Set();
    const filteredMessages = (messages || []).filter((msg, idx) => {
      if (!isGroupUpdatesActive && (msg.type === 'system' || msg.type === 'SYSTEM' || msg.isSystem)) {
        return false;
      }
      const keyId = msg.id || msg.tempId || `temp_idx_${idx}`;
      if (seenMsgIds.has(keyId)) {
        return false;
      }
      seenMsgIds.add(keyId);
      return true;
    });

    let lastDateGroup = null;
    filteredMessages.forEach((msg, i) => {
      const dateGroup = getMessageDateGroup(msg);
      if (dateGroup !== lastDateGroup) {
        items.push({
          type: 'date_separator',
          id: `date_sep_${dateGroup}_${msg.id || i}`,
          dateGroup
        });
        lastDateGroup = dateGroup;
      }
      items.push({
        type: 'message',
        id: msg.id ? `msg_${msg.id}` : `msg_idx_${i}`,
        msg,
        index: i,
        isLatestMessage: i === filteredMessages.length - 1
      });
    });

    if (typingUsers && typingUsers.size > 0) {
      Array.from(typingUsers.entries()).forEach(([userId, userName]) => {
        items.push({
          type: 'typing_indicator',
          id: `typing_${userId}`,
          userId,
          userName
        });
      });
    }

    // REVERSE the array for Inverted Architecture
    return items.reverse();
  }, [messages, conversation?.groupUpdatesActive, conversation?.isInstantMatch, hasMore]);

  const rowVirtualizer = useVirtualizer({
    count: itemsToRender.length,
    getScrollElement: () => bodyRef.current,
    getItemKey: (index) => itemsToRender[index].id,
    estimateSize: (index) => {
      const item = itemsToRender[index];
      if (item?.type === 'load_more') return 52;
      if (item?.type === 'instant_match_banner') return 44;
      if (item?.type === 'date_separator') return 36;
      if (item?.type === 'typing_indicator') return 54;
      if (item?.msg?.mediaUrl) return 240;
      if (item?.msg?.type === 'system' || item?.msg?.type === 'SYSTEM') return 40;
      return 68;
    },
    overscan: 8,
  });

  useLayoutEffect(() => {
    if (!bodyRef.current || !messages) return;

    const currentConvId = conversation?.id;
    const isNewConv = prevConvIdRef.current !== currentConvId;
    const currentCount = messages.length;
    const prevCount = prevMessagesCountRef.current;
    const firstMsgId = messages[0]?.id;
    const prevFirstMsgId = prevFirstMsgIdRef.current;

    // SCENARIO 1: Conversation switch or initial chat load
    if (isNewConv || (currentCount > 0 && prevCount === 0)) {
      prevConvIdRef.current = currentConvId;
      prevFirstMsgIdRef.current = firstMsgId;
      prevMessagesCountRef.current = currentCount;
      
      // In inverted layout, scrollTop 0 is visually the bottom.
      bodyRef.current.scrollTop = 0;
      return;
    }

    const isPrepend = firstMsgId !== prevFirstMsgId && currentCount > prevCount;

    // SCENARIO 2: Prepend (Loading older history)
    // Thanks to inverted architecture, we do absolutely nothing. 
    
    // SCENARIO 3: Append (New message sent or received)
    if (!isPrepend && currentCount > prevCount) {
      const lastMsg = messages[messages.length - 1];
      const isFromMe = lastMsg?.from === 'me' || String(lastMsg?.senderId) === String(currentUser?.id);
      const isNearBottom = bodyRef.current.scrollTop < 150;

      if (isFromMe || isNearBottom) {
        bodyRef.current.scrollTop = 0;
      }
    }

    prevFirstMsgIdRef.current = firstMsgId;
    prevMessagesCountRef.current = currentCount;
  }, [messages, conversation?.id, currentUser?.id, replyingTo]);

  // Fix inverted scroll wheel on PC/Windows
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollTop -= e.deltaY;
      }
    };
    
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const handleScroll = () => {
    if (!bodyRef.current) return;

    const isNearBottom = bodyRef.current.scrollTop < 150;
    if (onMarkSeen) {
      onMarkSeen(isNearBottom);
    }
    
    if (!hasMore || isLoadingMore || isLoading) return;
    
    // In inverted layout, scrolling "up" towards older messages means scrollTop approaches max scroll
    const isNearTop = bodyRef.current.scrollHeight - bodyRef.current.scrollTop - bodyRef.current.clientHeight < 350;
    
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
                  // CRITICAL: Combine TanStack translateY with inverted scaleY
                  transform: `translateY(${virtualItem.start}px) scaleY(-1)`,
                }}
              >
                {item.type === 'load_more' && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '0.75rem 0' }}>
                    <div 
                      className="spinner" 
                      style={{ 
                        width: '22px', 
                        height: '22px', 
                        borderWidth: '2.5px', 
                        borderStyle: 'solid',
                        borderColor: 'var(--color-primary) transparent transparent transparent',
                        borderRadius: '50%',
                        animation: 'spin 0.75s linear infinite'
                      }} 
                    />
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

                {item.type === 'typing_indicator' && (
                  <div className={`${styles.msgBubbleContainer} ${styles.msgBubbleContainerThem}`}>
                    <div className={styles.msgBubbleWrapper}>
                      <div className={styles.msgAvatar}>
                        <Avatar src={users?.[item.userId]?.avatar} name={item.userName} size="28px" />
                      </div>
                      <div className={styles.msgBubbleContent}>
                        <span className={styles.msgSenderName}>{item.userName}</span>
                        <div className={`${styles.msgBubble} ${styles.msgBubbleThem}`} style={{ padding: '10px 14px', width: 'fit-content' }}>
                          <div className={styles.typingIndicatorDots}>
                            <span className={styles.typingIndicatorDot}></span>
                            <span className={styles.typingIndicatorDot}></span>
                            <span className={styles.typingIndicatorDot}></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {item.type === 'message' && (
                  <MessageBubble
                    index={item.index}
                    isLatestMessage={item.isLatestMessage}
                    onRetry={onRetryMessage}
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
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && !error && itemsToRender.length === 0 && (
        <div className={`${styles.msgEmptyState} ${styles.msgInvertedItem}`}>No messages in this chat.</div>
      )}

      {isLoading && (
        <div className={styles.msgInvertedItem} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem', flex: 1 }}>
          <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '3px', borderTopColor: 'var(--color-primary)' }}></div>
        </div>
      )}

      {!isLoading && error && (
        <div className={styles.msgInvertedItem}>
          <ErrorState onRetry={retry} />
        </div>
      )}
    </div>
  );
}
