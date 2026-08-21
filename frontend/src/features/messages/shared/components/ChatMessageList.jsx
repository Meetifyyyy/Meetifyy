import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
import { ErrorState } from '@shared/components/ui/StateViews';
import Avatar from '@shared/components/avatar/Avatar';
import MessageBubble from './MessageBubble';
import { timeAgo } from '@shared/utils/time';
import { usePostLookup } from '@shared/hooks/usePostLookup';
import styles from './ChatMessageList.module.css';
import { getMsgTimestamp, compareMessages } from '../utils/cacheUtils';


// ─── Date Group Helpers ──────────────────────────────────────────────────────

const getRelativeDateString = (date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const msgDate = new Date(date);
  msgDate.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - msgDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return msgDate.toLocaleDateString(undefined, { weekday: 'long' });
  return msgDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const getMessageDateGroup = (msg) => {
  const rawDate = msg.createdAt || msg.timestamp;
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) return getRelativeDateString(d);
  }

  const time = msg.time || '';
  const clean = time.toLowerCase().trim();

  if (clean.includes('yesterday')) return 'Yesterday';
  if (clean === '1d ago') return 'Yesterday';
  if (clean.includes('2d ago')) {
    const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  if (clean.match(/^[3-7]d\s+ago/)) {
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
  if (rawKey && dateGroupCache.has(rawKey)) return dateGroupCache.get(rawKey);
  const result = getMessageDateGroup(msg);
  if (rawKey) {
    dateGroupCache.set(rawKey, result);
    if (dateGroupCache.size > 5000) {
      dateGroupCache.delete(dateGroupCache.keys().next().value);
    }
  }
  return result;
};

// ─── Memoized Message Row ────────────────────────────────────────────────────

const MessageRow = memo(function MessageRow({
  msg,
  index,
  isLatestMessage,
  conversation,
  currentUser,
  users,
  initial,
  searchQuery,
  onReply,
  onReplyTo,
  onContextMenu,
  onOpenContextMenu,
  onOpenMediaModal,
  onRetryUpload,
  onCancelUpload,
}) {
  return (
    <MessageBubble
      index={index}
      isLatestMessage={isLatestMessage}
      msg={msg}
      conversation={conversation}
      currentUser={currentUser}
      users={users}
      initial={initial}
      searchQuery={searchQuery}
      onReply={onReply}
      onReplyTo={onReplyTo || onReply}
      onContextMenu={onContextMenu || onOpenContextMenu}
      onOpenContextMenu={onOpenContextMenu}
      onOpenMediaModal={onOpenMediaModal}
      onRetryUpload={onRetryUpload}
      onCancelUpload={onCancelUpload}
    />
  );
}, (prev, next) => {
  // Only re-render if the message itself changed or key rendering props changed
  return (
    prev.msg === next.msg &&
    prev.isLatestMessage === next.isLatestMessage &&
    prev.searchQuery === next.searchQuery &&
    prev.conversation?.id === next.conversation?.id
  );
});

// ─── Main Component ──────────────────────────────────────────────────────────

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
  onMarkSeen,
  onRetryUpload,
  onCancelUpload,
  onOpenEmojiPicker,
}) {
  const getPostById = usePostLookup();
  const bodyRef = useRef(null);

  // Scroll position tracking
  const prevScrollHeightRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const hasScrolledInitialRef = useRef(false);
  const prevConvIdRef = useRef(null);
  const prevMessagesLengthRef = useRef(0);
  const prevFirstMsgIdRef = useRef(null);

  // Loading state guards
  const isLoadingOlderRef = useRef(false);
  const loadMoreTriggeredRef = useRef(false);

  // "New messages" badge
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const newMessagesRef = useRef(0);

  // ── Resolve typing user info ─────────────────────────────────────────────

  const firstTypingEntry = typingUsers?.size > 0 ? typingUsers.entries().next().value : null;
  const firstTypingUserId = firstTypingEntry?.[0];
  const firstTypingUserName = firstTypingEntry?.[1];

  const typingUserObj = firstTypingUserId
    ? (users?.[firstTypingUserId] || users?.[String(firstTypingUserId)])
    : null;
  const typingParticipant = firstTypingUserId
    ? (conversation?.participants?.find(p => String(p.id || p.userId || p._id) === String(firstTypingUserId)) ||
       conversation?.members?.find(p => String(p.id || p.userId || p._id) === String(firstTypingUserId)))
    : null;

  const typingAvatar =
    typingUserObj?.avatar || typingUserObj?.profileImage || typingUserObj?.avatarUrl ||
    typingParticipant?.avatar || typingParticipant?.profileImage || typingParticipant?.avatarUrl ||
    conversation?.otherUser?.avatar || conversation?.otherUser?.profileImage || conversation?.avatar || null;

  const typingName =
    typingUserObj?.displayName || typingUserObj?.name || typingUserObj?.username ||
    firstTypingUserName || typingParticipant?.displayName || typingParticipant?.name ||
    conversation?.otherUser?.displayName || conversation?.otherUser?.name || conversation?.name || '';

  // ── Build deduplicated, sorted message list ──────────────────────────────

  const sortedMessages = useMemo(() => {
    if (!messages || messages.length === 0) return [];

    const isGroupUpdatesActive = conversation?.groupUpdatesActive !== false;

    const seenMsgIds = new Map();
    let lastSystemText = null;

    const filtered = messages.filter((msg, idx) => {
      const isSystem = msg.type === 'system' || msg.type === 'SYSTEM' || msg.isSystem;
      if (!isGroupUpdatesActive && isSystem) return false;

      const text = (msg.text || msg.payload?.text || '').trim();
      if (isSystem) {
        if (text && text === lastSystemText) return false;
        lastSystemText = text;
      } else {
        lastSystemText = null;
      }

      const keyId = msg.id || msg.clientId || msg.tempId || `temp_idx_${idx}`;
      if (seenMsgIds.has(keyId)) return false;
      seenMsgIds.set(keyId, msg);
      return true;
    });

    return [...filtered].sort(compareMessages);
  }, [messages, conversation?.groupUpdatesActive]);

  // ── Mark seen ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isLoading && !error && sortedMessages.length > 0 && onMarkSeen) {
      const timer = setTimeout(() => {
        const isNearBottom = bodyRef.current
          ? (bodyRef.current.scrollHeight - bodyRef.current.scrollTop - bodyRef.current.clientHeight) < 150
          : true;
        onMarkSeen(isNearBottom);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [sortedMessages.length, isLoading, error, onMarkSeen]);

  // ── Reset when conversation changes ──────────────────────────────────────

  useEffect(() => {
    hasScrolledInitialRef.current = false;
    prevConvIdRef.current = null;
    prevFirstMsgIdRef.current = null;
    prevMessagesLengthRef.current = 0;
    prevScrollHeightRef.current = 0;
    isAtBottomRef.current = true;
    loadMoreTriggeredRef.current = false;
    isLoadingOlderRef.current = false;
    setNewMessagesCount(0);
    newMessagesRef.current = 0;
  }, [conversation?.id, conversation?.publicId, conversation?.internalId]);

  // ── SCROLL MANAGEMENT ────────────────────────────────────────────────────
  //
  // Three distinct scenarios:
  //  1. INITIAL LOAD → scroll to bottom
  //  2. PREPEND (older messages) → compensate scrollTop so viewport stays fixed
  //  3. APPEND (new message) → if user is near bottom, scroll to bottom;
  //     otherwise increment "new messages" badge
  //
  useLayoutEffect(() => {
    if (!bodyRef.current || isLoading) return;
    if (sortedMessages.length === 0) return;

    const container = bodyRef.current;
    const currentConvId = conversation?.id || conversation?.publicId;
    const currentCount = sortedMessages.length;
    const firstMsgId = sortedMessages[0]?.id;
    const lastMsgId = sortedMessages[sortedMessages.length - 1]?.id;
    const prevFirstMsgId = prevFirstMsgIdRef.current;
    const prevCount = prevMessagesLengthRef.current;

    // ── SCENARIO 1: Initial load for this conversation ──
    if (!hasScrolledInitialRef.current) {
      hasScrolledInitialRef.current = true;
      prevConvIdRef.current = currentConvId;
      prevFirstMsgIdRef.current = firstMsgId;
      prevMessagesLengthRef.current = currentCount;
      prevScrollHeightRef.current = container.scrollHeight;
      isAtBottomRef.current = true;

      // Scroll to the very bottom
      container.scrollTop = container.scrollHeight + 10000;
      return;
    }

    // ── SCENARIO 2: PREPEND — older messages loaded above ──
    // Identified when the first message ID changed AND count grew AND
    // the new first message is older than the previous first message
    const isPrepend =
      firstMsgId &&
      prevFirstMsgId &&
      firstMsgId !== prevFirstMsgId &&
      currentCount > prevCount;

    if (isPrepend) {
      const newScrollHeight = container.scrollHeight;
      const heightDiff = newScrollHeight - prevScrollHeightRef.current;

      if (heightDiff > 0) {
        // This runs synchronously before the browser paints — zero visible jump
        container.scrollTop = container.scrollTop + heightDiff;
      }

      prevScrollHeightRef.current = newScrollHeight;
      prevFirstMsgIdRef.current = firstMsgId;
      prevMessagesLengthRef.current = currentCount;
      isLoadingOlderRef.current = false;
      loadMoreTriggeredRef.current = false;
      return;
    }

    // ── SCENARIO 3: APPEND — new message arrived or sent ──
    if (currentCount > prevCount && !isPrepend) {
      prevMessagesLengthRef.current = currentCount;
      prevFirstMsgIdRef.current = firstMsgId;

      const lastMsg = sortedMessages[sortedMessages.length - 1];
      const isFromMe =
        lastMsg?.from === 'me' ||
        String(lastMsg?.senderId) === String(currentUser?.id);

      if (isAtBottomRef.current || isFromMe) {
        // User is at bottom or it's their own message → follow scroll
        container.scrollTop = container.scrollHeight + 10000;
        isAtBottomRef.current = true;
        prevScrollHeightRef.current = container.scrollHeight;
        setNewMessagesCount(0);
        newMessagesRef.current = 0;
      } else {
        // User is reading history → show badge, don't scroll
        const addedCount = currentCount - prevCount;
        newMessagesRef.current += addedCount;
        setNewMessagesCount(newMessagesRef.current);
        prevScrollHeightRef.current = container.scrollHeight;
      }
      return;
    }

    // Update refs for cases that didn't match any scenario
    prevFirstMsgIdRef.current = firstMsgId;
    prevMessagesLengthRef.current = currentCount;
    prevScrollHeightRef.current = container.scrollHeight;
  }, [sortedMessages, isLoading, conversation?.id, conversation?.publicId, currentUser?.id]);

  // ── RESIZE OBSERVER: compensate when images/media cause layout changes ───
  // When the user is NOT at the bottom, height changes from media loading
  // should shift the scrollTop so the viewport stays fixed.
  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    const container = bodyRef.current;

    const observer = new ResizeObserver(() => {
      if (!hasScrolledInitialRef.current || !container) return;

      const newScrollHeight = container.scrollHeight;
      const diff = newScrollHeight - prevScrollHeightRef.current;
      if (diff === 0) return;

      if (isAtBottomRef.current) {
        container.scrollTop = newScrollHeight + 10000;
      } else {
        container.scrollTop = container.scrollTop + diff;
      }
      prevScrollHeightRef.current = newScrollHeight;
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [conversation?.id, conversation?.publicId]);

  // ── SCROLL EVENT HANDLER ─────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const container = bodyRef.current;
    if (!container) return;

    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const wasAtBottom = isAtBottomRef.current;
    isAtBottomRef.current = distFromBottom < 180;

    // Clear "new messages" badge once user scrolls to bottom
    if (isAtBottomRef.current && newMessagesRef.current > 0) {
      setNewMessagesCount(0);
      newMessagesRef.current = 0;
    }

    // Top-reached detection: trigger load of older messages
    if (!hasMore || isLoadingOlderRef.current || loadMoreTriggeredRef.current) return;
    if (isLoading || isLoadingMore) return;

    const distFromTop = container.scrollTop;
    if (distFromTop <= 150) {
      // Capture scrollHeight BEFORE the new content is inserted
      prevScrollHeightRef.current = container.scrollHeight;
      isLoadingOlderRef.current = true;
      loadMoreTriggeredRef.current = true;
      if (onLoadMore) onLoadMore();
    }
  }, [hasMore, isLoading, isLoadingMore, onLoadMore]);

  // Reset load guard when isLoadingMore transitions false → we're done prepending
  useEffect(() => {
    if (!isLoadingMore) {
      // Small delay to let the DOM settle before re-enabling
      const t = setTimeout(() => {
        isLoadingOlderRef.current = false;
        // Don't reset loadMoreTriggeredRef here — it resets in the layout effect after prepend
      }, 100);
      return () => clearTimeout(t);
    }
  }, [isLoadingMore]);

  // ── Scroll to bottom via "New messages" button ───────────────────────────

  const scrollToBottom = useCallback(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight + 10000;
      isAtBottomRef.current = true;
      prevScrollHeightRef.current = bodyRef.current.scrollHeight;
    }
    setNewMessagesCount(0);
    newMessagesRef.current = 0;
  }, []);

  // ── Build render items list ──────────────────────────────────────────────

  const renderItems = useMemo(() => {
    const items = [];

    if (sortedMessages.length === 0) return items;

    let lastDateGroup = null;
    sortedMessages.forEach((msg, i) => {
      const dateGroup = getMessageDateGroupMemoized(msg);
      const stableKey = msg.id || msg.clientId || msg.tempId || `idx_${i}`;

      if (dateGroup !== lastDateGroup) {
        items.push({
          type: 'date_separator',
          key: `date_sep_${dateGroup}_${stableKey}`,
          dateGroup,
        });
        lastDateGroup = dateGroup;
      }

      items.push({
        type: 'message',
        key: `msg_${stableKey}`,
        msg,
        index: i,
        isLatestMessage: i === sortedMessages.length - 1,
      });
    });

    return items;
  }, [sortedMessages]);

  // ── RENDER ───────────────────────────────────────────────────────────────

  const isGroup = conversation?.isGroup || conversation?.type === 'GROUP';

  return (
    <div className={styles.msgChatBody} ref={bodyRef} onScroll={handleScroll}>

      {/* ── Top loading indicator (loading older messages) ── */}
      {(hasMore || isLoadingMore) && !isLoading && (
        <div className={styles.topLoadingIndicator}>
          <div className={styles.topLoadingSpinner} />
          <span className={styles.topLoadingText}>Loading older messages…</span>
        </div>
      )}

      {/* ── Beginning of conversation marker ── */}
      {!hasMore && !isLoading && sortedMessages.length > 0 && (
        <div className={styles.beginningOfConversation}>
          <span>Beginning of conversation</span>
        </div>
      )}

      {/* ── Instant-match banner (first item after beginning marker) ── */}
      {conversation?.isInstantMatch && !isLoading && sortedMessages.length > 0 && (
        <div className={styles.msgDateSeparator} style={{ margin: '0.5rem 0' }}>
          <span className={styles.msgDateSeparatorLine} />
          <span
            className={styles.msgDateSeparatorText}
            style={{
              background: 'rgba(234, 179, 8, 0.12)',
              color: '#eab308',
              padding: '4px 14px',
              borderRadius: '14px',
              fontWeight: 600,
              fontSize: '0.78rem',
            }}
          >
            ⚡ Instant Match started {conversation.createdAt ? timeAgo(conversation.createdAt) : 'recently'}
          </span>
          <span className={styles.msgDateSeparatorLine} />
        </div>
      )}

      {/* ── Message list ── */}
      {!isLoading && !error && renderItems.length > 0 && renderItems.map((item) => {
        if (item.type === 'date_separator') {
          return (
            <div key={item.key} className={styles.msgDateSeparator}>
              <span className={styles.msgDateSeparatorLine} />
              <span className={styles.msgDateSeparatorText}>{item.dateGroup}</span>
              <span className={styles.msgDateSeparatorLine} />
            </div>
          );
        }

        if (item.type === 'message') {
          return (
            <MessageRow
              key={item.key}
              msg={item.msg}
              index={item.index}
              isLatestMessage={item.isLatestMessage}
              conversation={conversation}
              currentUser={currentUser}
              users={users}
              initial={initial}
              searchQuery={searchQuery}
              onReply={onReply}
              onReplyTo={onReplyTo}
              onContextMenu={onContextMenu || onOpenContextMenu}
              onOpenContextMenu={onOpenContextMenu}
              onOpenMediaModal={onOpenMediaModal || openViewer}
              onRetryUpload={onRetryUpload}
              onCancelUpload={onCancelUpload}
            />
          );
        }

        return null;
      })}

      {/* ── Typing indicator ── */}
      {isTyping && (
        <div className={`${styles.msgBubbleContainer} ${styles.msgBubbleContainerThem}`}>
          <div className={styles.msgBubbleWrapper}>
            <div className={styles.msgAvatar}>
              <Avatar src={typingAvatar} name={typingName} size="28px" />
            </div>
            <div className={styles.msgBubbleContent}>
              {isGroup && typingName && (
                <span className={styles.msgSenderName}>{typingName}</span>
              )}
              <div className={`${styles.msgMainRow} ${styles.msgMainRowThem}`}>
                <div
                  className={`${styles.msgBubble} ${styles.msgBubbleThem}`}
                  style={{ display: 'inline-flex', alignItems: 'center', padding: '0.65rem 0.95rem' }}
                >
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

      {/* ── Empty state ── */}
      {!isLoading && !error && renderItems.length === 0 && !isTyping && (
        <div className={styles.msgEmptyState}>No messages in this chat.</div>
      )}

      {/* ── Full-screen spinner (initial load only) ── */}
      {isLoading && (
        <div className={styles.msgInitialLoadingCenter}>
          <div
            className="spinner"
            style={{
              width: '24px',
              height: '24px',
              borderWidth: '3px',
              borderTopColor: 'var(--color-primary)',
            }}
          />
        </div>
      )}

      {/* ── Error state ── */}
      {!isLoading && error && (
        <div>
          <ErrorState onRetry={retry} />
        </div>
      )}

      {/* ── "New messages" floating badge ── */}
      {newMessagesCount > 0 && (
        <button
          type="button"
          className={styles.newMessagesBtn}
          onClick={scrollToBottom}
          aria-label={`${newMessagesCount} new message${newMessagesCount > 1 ? 's' : ''} — scroll to bottom`}
        >
          <span className={styles.newMessagesBtnArrow}>↓</span>
          <span>
            {newMessagesCount} new message{newMessagesCount !== 1 ? 's' : ''}
          </span>
        </button>
      )}
    </div>
  );
}
