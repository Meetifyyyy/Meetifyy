import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
import { ErrorState } from '@shared/components/ui/StateViews';
import Avatar from '@shared/components/avatar/Avatar';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { showToast } from '@shared/utils/toast';
import MessageBubble from './MessageBubble';
import { captureScrollAnchor, restoreScrollAnchor } from '../utils/scrollAnchor';
import styles from './ChatMessageList.module.css';
import { useOnlineStatus } from '@shared/lib/networkStatus';

/*
 * First-load placeholder for a thread: a few bubble-shaped blocks alternating
 * sides, bottom-aligned like the real thread so nothing jumps when messages
 * arrive. Deliberately few and fixed - it stands for "messages go here", not
 * for a count of anything.
 */
const MESSAGE_SKELETON_ROWS = [
  { mine: false, width: '58%' },
  { mine: true, width: '44%' },
  { mine: false, width: '66%' },
  { mine: true, width: '52%' },
  { mine: false, width: '38%' },
];

function MessageListSkeleton() {
  return (
    <div className={styles.msgSkeleton} role="status" aria-label="Loading messages">
      {MESSAGE_SKELETON_ROWS.map((row, i) => (
        <div
          key={i}
          className={`${styles.msgSkeletonRow} ${row.mine ? styles.msgSkeletonRowMine : ''}`}
        >
          <Skeleton
            width={row.width}
            height="2.5rem"
            className={styles.msgSkeletonBubble}
            style={{ borderRadius: '1.1rem' }}
          />
        </div>
      ))}
    </div>
  );
}
import { compareMessages, checkIsMe, isSystemMessage, getMsgTimestamp } from '../utils/cacheUtils';
import AdminJoinRequestLine from './AdminJoinRequestLine';
import { closesUpFlags } from '../utils/messageRuns';
import { isPostReply } from './reply';
import { createMessageHighlighter } from '../utils/messageHighlight';


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
  continuesRun: inRun,
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
  onRetrySend,
  onCancelUpload,
  onJumpToMessage,
}) {
  return (
    <MessageBubble
      onJumpToMessage={onJumpToMessage}
      index={index}
      isLatestMessage={isLatestMessage}
      continuesRun={inRun}
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
      onRetrySend={onRetrySend}
      onCancelUpload={onCancelUpload}
    />
  );
}, (prev, next) => {
  // Only re-render if the message itself changed or key rendering props changed
  return (
    prev.msg === next.msg &&
    prev.isLatestMessage === next.isLatestMessage &&
    // A neighbour arriving, being unsent or being filtered out changes whether
    // this row is the start of a run, though the message itself is untouched.
    prev.continuesRun === next.continuesRun &&
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
  onRetrySend,
  onCancelUpload,
  onOpenEmojiPicker,
  // Requests to join, for a group's owner and admins only (the caller passes
  // them only to those; see AdminJoinRequestLine). Never part of `messages`.
  adminUpdates = null,
  onReviewRequests,
}) {
  const bodyRef = useRef(null);

  // Scroll position tracking
  const prevScrollHeightRef = useRef(0);
  // Where the topmost visible message sat before the last commit; see
  // utils/scrollAnchor for why a prepend restores this instead of adding the
  // scrollHeight growth (which double-counted the browser's own anchoring).
  const scrollAnchorRef = useRef(null);
  const isAtBottomRef = useRef(true);
  // The scroller's own height at the last resize, to tell its BOX changing
  // (below) from its content changing. Never reset with the conversation: it
  // describes the layout, not the thread, and the reset effect also runs on
  // mount, after the first reading, which wiped it.
  const prevClientHeightRef = useRef(null);
  const hasScrolledInitialRef = useRef(false);
  const prevConvIdRef = useRef(null);
  const prevMessagesLengthRef = useRef(0);
  const prevFirstMsgIdRef = useRef(null);

  // Loading state guards
  const online = useOnlineStatus();
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
    // Find-in-chat. `searchQuery` was threaded all the way down to
    // MessageBubble — which never read it — so typing in the search bar did
    // nothing at all: no filter, no highlight, no count. The thread is
    // narrowed to matching messages here, and MessageBubble marks the hit
    // inside each one.
    const needle = (searchQuery || '').trim().toLowerCase();

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

      if (needle) {
        // System notices are chat furniture, not things anyone searches for.
        if (isSystem) return false;
        const haystack = `${msg.text || msg.payload?.text || ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    return [...filtered].sort(compareMessages);
  }, [messages, conversation?.groupUpdatesActive, searchQuery]);

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
  //
  // A layout effect, declared before the scroll management below, so it runs
  // first. It was a plain effect, and React runs those AFTER layout effects:
  // a chat that opened with its messages already cached had its initial
  // scroll (below) done and then undone, `hasScrolledInitialRef` back to false
  // and the recorded scroll height back to 0. Until the next message arrived,
  // the keyboard observer and the image-load re-pin both bailed out on that
  // flag, so the thread neither followed the keyboard (the newest messages
  // went behind it) nor stayed on the latest message as photos loaded.
  useLayoutEffect(() => {
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
      // Runs before paint. Restores the reader's message to the offset it had,
      // whether or not the browser's scroll anchoring already moved it.
      restoreScrollAnchor(container, scrollAnchorRef.current);
      scrollAnchorRef.current = captureScrollAnchor(container);
      isAtBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight < 180;

      prevScrollHeightRef.current = container.scrollHeight;
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
    scrollAnchorRef.current = captureScrollAnchor(container);
    prevFirstMsgIdRef.current = firstMsgId;
    prevMessagesLengthRef.current = currentCount;
    prevScrollHeightRef.current = container.scrollHeight;
  }, [sortedMessages, isLoading, conversation?.id, conversation?.publicId, currentUser?.id]);

  // ── LATE CONTENT: keep the thread pinned while it settles ────────────────
  //
  // The initial scroll below runs in a layout effect, before paint, so the
  // thread is at the bottom the first time it is drawn. It then drifted anyway,
  // and the reason is that `scrollHeight` at that moment is not final: message
  // images and videos carry no intrinsic dimensions until they load, and web
  // fonts reflow the text. Each one that arrives grows the content BELOW the
  // viewport, which is what produced the "opens near the top, then jumps"
  // behaviour.
  //
  // The ResizeObserver further down cannot catch this. It observes the
  // scroller, and the scroller is `flex: 1` inside a fixed-height column — its
  // own box never changes when its CONTENT grows, so the callback simply does
  // not run for the case it was written for.
  //
  // A capture-phase `load` listener does catch it: `load` does not bubble, but
  // it does capture, so one listener on the container sees every image and
  // video inside it finish. Re-pinning only while `isAtBottomRef` is true means
  // this never fights a user who has scrolled up to read history.
  useLayoutEffect(() => {
    const container = bodyRef.current;
    if (!container) return undefined;

    const pinIfAtBottom = () => {
      if (!hasScrolledInitialRef.current) return;
      if (!isAtBottomRef.current) return;
      container.scrollTop = container.scrollHeight + 10000;
      prevScrollHeightRef.current = container.scrollHeight;
    };

    container.addEventListener('load', pinIfAtBottom, true);

    // Fonts reflow every bubble at once and land after the first paint.
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => { if (!cancelled) pinIfAtBottom(); }).catch(() => {});
    }

    return () => {
      cancelled = true;
      container.removeEventListener('load', pinIfAtBottom, true);
    };
  }, [conversation?.id, conversation?.publicId]);

  // ── RESIZE OBSERVER: compensate when the VIEWPORT changes size ───────────
  // Keyboard open/close, window resize, pane resize. Content growth is handled
  // by the load listener above, for the reason given there.
  //
  // In the Android app the keyboard changes neither the window nor this box:
  // the thread slides up under the header instead and adds the same amount to
  // its top padding (ChatMessageList.module.css), so its first message stays
  // reachable. That shrinks the CONTENT box, which is what a ResizeObserver
  // reports by default, so the keyboard arrives here once per open or close,
  // in the frame the padding changes, after layout and before paint. There the
  // thread is bottom-anchored, so the padding pushes content down by exactly
  // the growth of scrollHeight, and the shift below cancels it: nothing moves
  // inside the thread, and the only motion is the slide.
  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    const container = bodyRef.current;

    const observer = new ResizeObserver(() => {
      if (!container) return;

      // The thread's own box changed height: the composer grew (a reply bar
      // opened above it), a window resized, the keyboard took a share of the
      // screen. Its content did not, so `scrollHeight` is the same and the
      // check below sees nothing to do - and a thread sitting at the bottom
      // would be left with its last messages pushed out of view. Stay on the
      // latest message instead.
      //
      // The height is recorded on EVERY call, before the early return below:
      // the first notification arrives before the initial scroll has happened,
      // and skipping the record there made the first real resize look like the
      // first reading, so it was never acted on.
      const clientHeight = container.clientHeight;
      const boxResized = prevClientHeightRef.current !== null && clientHeight !== prevClientHeightRef.current;
      prevClientHeightRef.current = clientHeight;
      if (!hasScrolledInitialRef.current) return;
      if (boxResized && isAtBottomRef.current) {
        container.scrollTop = container.scrollHeight + 10000;
        prevScrollHeightRef.current = container.scrollHeight;
        return;
      }

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


  // ── Jump to a quoted message ───────────────────────────────────────────────
  //
  // Reply quotes are clickable: clicking one scrolls to the original and flashes
  // it. If the original is not in the DOM it lives further back in history, so
  // older pages are requested until it appears.
  //
  // Deliberately DOM-driven rather than index-driven: the rendered list is the
  // only thing that knows what is currently mounted, and querying it avoids
  // duplicating the windowing/grouping rules that build the rows.
  const jumpTokenRef = useRef(0);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(isLoadingMore);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingMoreRef.current = isLoadingMore; }, [isLoadingMore]);
  // Read through a ref so jumpToMessage keeps a stable identity: MessageRow's
  // memo comparison ignores it, so a changing identity would leave rows holding
  // the first closure and calling a stale loader.
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);

  const findMessageEl = useCallback((messageId) => {
    const container = bodyRef.current;
    if (!container || !messageId) return null;
    // The fallback escapes backslashes as well as quotes: escaping `"` alone
    // left an id ending in `\` able to escape the closing quote.
    const safe = (window.CSS && CSS.escape) ? CSS.escape(String(messageId)) : String(messageId).replace(/["\\]/g, '\\$&');
    return container.querySelector(`[data-message-id="${safe}"]`)
        || container.querySelector(`[data-client-id="${safe}"]`);
  }, []);

  /**
   * One highlight at a time, for the life of this list.
   *
   * Held in a ref rather than created per call so that taking a new highlight
   * releases the previous one, and so the pending timer can be cancelled. The
   * old code created an untracked timer per flash: clicking two different reply
   * previews left both messages glowing, and clicking the same one twice let
   * the first timer clear the second highlight early.
   */
  const highlighterRef = useRef(null);
  if (highlighterRef.current === null) {
    highlighterRef.current = createMessageHighlighter({
      className: styles.msgJumpHighlight,
      durationMs: 1800,
    });
  }

  const flashMessage = useCallback((el) => {
    highlighterRef.current.highlight(el);
  }, []);

  const scrollToEl = useCallback((el) => {
    // Suppress the "stick to bottom" behaviour for this scroll; the user is
    // deliberately moving away from the latest message.
    isAtBottomRef.current = false;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    flashMessage(el);
  }, [flashMessage]);

  const jumpToMessage = useCallback((messageId) => {
    if (!messageId) return;
    const token = ++jumpTokenRef.current;

    const existing = findMessageEl(messageId);
    if (existing) { scrollToEl(existing); return; }

    // Not mounted — walk back through history. Capped so a reply pointing at a
    // message that no longer exists cannot page forever.
    const MAX_PAGES = 15;
    const POLL_MS = 100;
    const PAGE_TIMEOUT_MS = 4000;
    let pages = 0;

    const requestOlder = () => {
      // A newer jump superseded this one, or the conversation changed.
      if (token !== jumpTokenRef.current) return;

      const el = findMessageEl(messageId);
      if (el) {
        // Let the prepend's scroll compensation settle before moving the
        // viewport, otherwise the two fight and the jump lands short.
        window.setTimeout(() => {
          if (token !== jumpTokenRef.current) return;
          const still = findMessageEl(messageId);
          if (still) scrollToEl(still);
        }, 60);
        return;
      }

      if (!hasMoreRef.current || pages >= MAX_PAGES) {
        showToast('Original message is no longer available', 'info');
        return;
      }

      pages += 1;
      if (!loadingMoreRef.current && onLoadMoreRef.current) onLoadMoreRef.current();

      const startedAt = Date.now();
      const poll = () => {
        if (token !== jumpTokenRef.current) return;
        if (findMessageEl(messageId)) { requestOlder(); return; }
        if (Date.now() - startedAt > PAGE_TIMEOUT_MS) { requestOlder(); return; }
        window.setTimeout(poll, POLL_MS);
      };
      window.setTimeout(poll, POLL_MS);
    };

    requestOlder();
  }, [findMessageEl, scrollToEl]);

  // Cancel any in-flight jump when the conversation changes, and drop the
  // highlight: the element it points at is about to be unmounted, and a timer
  // that outlives it would call classList on a detached node.
  useEffect(() => {
    jumpTokenRef.current += 1;
    highlighterRef.current?.clear();
  }, [conversation?.id]);

  useEffect(() => () => highlighterRef.current?.clear(), []);

  const handleScroll = useCallback(() => {
    const container = bodyRef.current;
    if (!container) return;

    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isAtBottomRef.current = distFromBottom < 180;
    // Kept current on every scroll so a page that lands mid-fling (or one
    // requested by a reply jump) restores against where the reader is now.
    scrollAnchorRef.current = captureScrollAnchor(container);

    // Clear "new messages" badge once user scrolls to bottom
    if (isAtBottomRef.current && newMessagesRef.current > 0) {
      setNewMessagesCount(0);
      newMessagesRef.current = 0;
    }

    // Top-reached detection: trigger load of older messages
    if (!hasMore || isLoadingOlderRef.current || loadMoreTriggeredRef.current) return;
    if (isLoading || isLoadingMore) return;

    // Request the next page while about one screen of history is still above
    // the viewport, so it is usually in place before the reader reaches it.
    const distFromTop = container.scrollTop;
    if (distFromTop <= Math.max(300, container.clientHeight)) {
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
        // Also re-arm here: a page that adds nothing new (all duplicates, or a
        // failed request) never reaches the prepend branch, and the trigger
        // used to stay latched, so older history stopped loading for good.
        loadMoreTriggeredRef.current = false;
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

  const isGroup = Boolean(conversation?.isGroup || conversation?.type === 'GROUP');

  // The admins' request lines, in time order, within the span of history that
  // is loaded (older ones would all pile up above the first message), and
  // never in find-in-chat results.
  const adminRows = useMemo(() => {
    if (!Array.isArray(adminUpdates) || adminUpdates.length === 0) return [];
    if ((searchQuery || '').trim()) return [];
    const oldest = sortedMessages.length > 0 ? getMsgTimestamp(sortedMessages[0]) : 0;
    return adminUpdates
      .map((item) => ({ item, ts: Date.parse(item?.createdAt || '') }))
      .filter(({ ts }) => Number.isFinite(ts) && (!hasMore || ts >= oldest))
      .sort((a, b) => a.ts - b.ts);
  }, [adminUpdates, sortedMessages, hasMore, searchQuery]);

  const renderItems = useMemo(() => {
    const items = [];

    if (sortedMessages.length === 0 && adminRows.length === 0) return items;

    let lastDateGroup = null;
    const separate = (dateGroup, stableKey) => {
      if (dateGroup === lastDateGroup) return;
      items.push({
        type: 'date_separator',
        key: `date_sep_${dateGroup}_${stableKey}`,
        dateGroup,
      });
      lastDateGroup = dateGroup;
    };
    let nextAdmin = 0;
    const pushAdminRowsBefore = (ts) => {
      while (nextAdmin < adminRows.length && adminRows[nextAdmin].ts < ts) {
        const { item } = adminRows[nextAdmin];
        separate(getMessageDateGroup({ createdAt: item.createdAt }), `jr_${item.id}`);
        items.push({ type: 'admin_update', key: `jr_${item.id}_${item.createdAt}`, item });
        nextAdmin += 1;
      }
    };

    sortedMessages.forEach((msg, i) => {
      pushAdminRowsBefore(getMsgTimestamp(msg));
      const dateGroup = getMessageDateGroupMemoized(msg);
      const stableKey = msg.id || msg.clientId || msg.tempId || `idx_${i}`;
      separate(dateGroup, stableKey);

      items.push({
        type: 'message',
        key: `msg_${stableKey}`,
        msg,
        index: i,
        isLatestMessage: i === sortedMessages.length - 1,
      });
    });
    pushAdminRowsBefore(Infinity);

    // Which rows close up against the one above. A date separator between two
    // messages breaks a run (a new day starts a new one), so it is an item here
    // like any other.
    const closesUp = closesUpFlags(items, { currentUser, isGroup, isPostReply });
    return items.map((item, k) => (item.type === 'message' ? { ...item, closesUp: closesUp[k] } : item));
  }, [sortedMessages, adminRows, currentUser, isGroup]);

  // The typing indicator is one more row at the bottom of the thread, so it
  // follows the same rule: it sits close to the last message when that is from
  // the person typing, and a full gap away when it is yours.
  const lastMessage = sortedMessages.length > 0 ? sortedMessages[sortedMessages.length - 1] : null;
  const typingContinuesRun = Boolean(
    lastMessage &&
    !isSystemMessage(lastMessage) &&
    !checkIsMe(lastMessage, currentUser) &&
    (!isGroup || !firstTypingUserId ||
      String(lastMessage.senderId ?? lastMessage.sender?.id ?? lastMessage.userId) === String(firstTypingUserId)),
  );

  // A group's typing row carries the typist's name above its bubble, so like any
  // row that opens with a label it does not close up against the message above.
  const typingClosesUp = typingContinuesRun && !(isGroup && typingName);

  // ── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.msgChatBody} ref={bodyRef} onScroll={handleScroll}>

      {/* ── Top loading indicator (loading older messages) ── */}
      {(hasMore || isLoadingMore) && !isLoading && (
        <div className={styles.topLoadingIndicator}>
          <div className={styles.topLoadingSpinner} role="status" aria-label="Loading older messages" />
        </div>
      )}

      {/* ── Message list ── */}
      {!isLoading && !error && renderItems.length > 0 && renderItems.map((item) => {
        if (item.type === 'date_separator') {
          return (
            <div key={item.key} className={styles.msgDateSeparator}>
              {/* The date stands on its own now — a bordered pill rather than a
                  label threaded through a rule. The two lines were doing the
                  separating; the outline does it, and takes less width to do
                  it in a narrow pane. */}
              <span className={styles.msgDateSeparatorText}>{item.dateGroup}</span>
            </div>
          );
        }

        if (item.type === 'admin_update') {
          return <AdminJoinRequestLine key={item.key} item={item.item} onReview={onReviewRequests} />;
        }

        if (item.type === 'message') {
          return (
            <MessageRow
              key={item.key}
              msg={item.msg}
              index={item.index}
              isLatestMessage={item.isLatestMessage}
              continuesRun={item.closesUp}
              conversation={conversation}
              currentUser={currentUser}
              users={users}
              initial={initial}
              searchQuery={searchQuery}
              onReply={onReply}
              onReplyTo={onReplyTo}
              onContextMenu={onContextMenu || onOpenContextMenu}
              onOpenContextMenu={onOpenContextMenu}
              onOpenMediaModal={onOpenMediaModal}
              onRetryUpload={onRetryUpload}
              onRetrySend={onRetrySend}
              onCancelUpload={onCancelUpload}
              onJumpToMessage={jumpToMessage}
            />
          );
        }

        return null;
      })}

      {/* ── Typing indicator ── */}
      {isTyping && (
        <div
          className={`${styles.msgBubbleContainer} ${styles.msgBubbleContainerThem}`}
          data-run={typingClosesUp ? 'continue' : undefined}
        >
          <div className={styles.msgBubbleWrapper}>
            <div className={styles.msgAvatar}>
              <Avatar src={typingAvatar} name={typingName} size="28px" />
            </div>
            <div className={styles.msgBubbleContent}>
              {isGroup && typingName && (
                <span className={styles.msgSenderName}>{typingName}</span>
              )}
              <div className={`${styles.msgMainRow} ${styles.msgMainRowThem}`}>
                {/* Built the way a text message is (bubble > text wrap > text),
                    with the dots standing where the words would, so it is the
                    height of a one-line message and the thread does not shift
                    when the real message takes its place. */}
                <div className={`${styles.msgBubble} ${styles.msgBubbleThem}`}>
                  <div className={styles.msgTextTimeWrap}>
                    <div className={styles.msgTextContent}>
                      <span className={styles.msgText}>
                        <span className={styles.typingBubbleInline} role="status" aria-label="Typing">
                          <span className={styles.typingDot} />
                          <span className={styles.typingDot} />
                          <span className={styles.typingDot} />
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!isLoading && !error && renderItems.length === 0 && !isTyping && (
        <div className={styles.msgEmptyState}>
          {(searchQuery || '').trim()
            ? `No messages match “${searchQuery.trim()}”.`
            : online
              ? 'No messages in this chat.'
              // Not "no messages": nothing is saved for this chat on this device.
              : "You're offline. This chat will load when you're back online."}
        </div>
      )}

      {/* ── Message skeleton (initial load only) ── */}
      {isLoading && <MessageListSkeleton />}

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
