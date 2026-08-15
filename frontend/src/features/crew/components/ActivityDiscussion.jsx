import { useEffect, useLayoutEffect, useRef, useState, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X, Send, ChevronUp } from 'lucide-react';
import Avatar from '@shared/components/avatar/Avatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { useAuth } from '@shared/context/AuthContext';
import { timeAgo } from '@shared/utils/time';
import { useActivityDiscussion } from '../hooks/useActivityDiscussion';
import styles from './ActivityDiscussion.module.css';

/**
 * Core discussion panel — a scrollable message area plus an input.
 *
 * Scroll contract:
 *  - The ONLY scroller is `.messages` (scrollRef).
 *  - We NEVER call element.scrollIntoView() because it propagates up every
 *    ancestor scroll container and moves the parent Activity Detail page.
 *  - Instead we directly mutate scrollRef.current.scrollTop, which is
 *    always contained to the messages element itself.
 */
export const ActivityDiscussion = memo(function ActivityDiscussion({
  activityId,
  variant = 'inline',
  onClose,
  enabled = true,
}) {
  const { currentUser } = useAuth();
  const {
    messages,
    isLoading,
    isError,
    hasMore,
    isFetchingMore,
    loadMore,
    sendMessage,
    isSending,
    sendError,
  } = useActivityDiscussion(activityId, { enabled });

  const [draft, setDraft] = useState('');
  const scrollRef           = useRef(null);
  const prevScrollHeightRef = useRef(0);
  const isNearBottomRef     = useRef(true);
  const lastCountRef        = useRef(0);

  /**
   * Scroll ONLY the messages container to the very bottom.
   * Direct scrollTop assignment never propagates to parent scrollers —
   * unlike scrollIntoView() which climbs the entire ancestor chain.
   */
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Track scroll position so we know whether new messages should auto-scroll.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  // After messages change:
  //   • Prepend (load older) → anchor viewport so content doesn't jump.
  //   • Append  (new send)   → scroll to bottom IF user was near bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const count    = messages.length;
    const grewAtTop =
      count > lastCountRef.current && !isNearBottomRef.current;

    if (grewAtTop && prevScrollHeightRef.current) {
      // Restore viewport anchor after prepend — no visual jump.
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    } else if (isNearBottomRef.current) {
      // New message arrived and user is at the bottom — follow it.
      el.scrollTop = el.scrollHeight;
    }

    lastCountRef.current      = count;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [messages]);

  // Snap to bottom once the initial message history has loaded.
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      // rAF gives the browser one paint cycle to lay out the messages first.
      requestAnimationFrame(scrollToBottom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const handleLoadOlder = useCallback(() => {
    const el = scrollRef.current;
    if (el) prevScrollHeightRef.current = el.scrollHeight;
    isNearBottomRef.current = false;
    loadMore();
  }, [loadMore]);

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (!text || isSending) return;

    setDraft('');
    // Mark as near-bottom so the new optimistic message gets auto-scrolled.
    isNearBottomRef.current = true;

    try {
      await sendMessage(text);
    } catch {
      // Restore draft on failure so the user can retry.
      setDraft(text);
    }
  }, [draft, isSending, sendMessage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const panelContent = (
    <div
      className={`${styles.panel} ${
        variant === 'floating' ? styles.floating : styles.inline
      }`}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <MessageCircle size={16} />
          <span>Discussion</span>
        </div>
        {variant === 'floating' && onClose && (
          <button
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close discussion"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* ── Messages ───────────────────────────────────────────── */}
      <div className={styles.messages} ref={scrollRef} onScroll={handleScroll}>
        {hasMore && !isLoading && (
          <button
            className={styles.loadOlderBtn}
            onClick={handleLoadOlder}
            disabled={isFetchingMore}
          >
            <ChevronUp size={14} />
            {isFetchingMore ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}

        {isLoading ? (
          <div className={styles.stateMsg}>
            <span className={styles.spinner} />
          </div>
        ) : isError ? (
          <div className={styles.stateMsg}>Couldn't load the discussion.</div>
        ) : messages.length === 0 ? (
          <div className={styles.emptyState}>
            <MessageCircle size={26} strokeWidth={1.5} />
            <p className={styles.emptyTitle}>No messages yet</p>
            <p className={styles.emptyDesc}>
              Start the conversation about this activity.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = String(m.userId) === String(currentUser?.id);
            return (
              <div
                key={m.id}
                className={`${styles.msgRow} ${isMe ? styles.msgRowMe : ''}`}
              >
                {!isMe && (
                  <Avatar
                    src={m.user?.avatar}
                    name={m.user?.displayName || m.user?.username}
                    size="28px"
                  />
                )}
                <div className={styles.msgBody}>
                  <div className={styles.msgMeta}>
                    <span className={styles.msgName}>
                      {isMe
                        ? 'You'
                        : m.user?.displayName ||
                          m.user?.username ||
                          'Member'}
                    </span>
                    <CollegeRepresentativeBadge isCampusRep={m.user?.isCampusRep} size="sm" />
                    <span className={styles.msgTime}>
                      {timeAgo(m.createdAt)}
                    </span>
                  </div>
                  <div
                    className={`${styles.bubble} ${
                      isMe ? styles.bubbleMe : ''
                    } ${m.pending ? styles.bubblePending : ''}`}
                  >
                    {m.text}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Zero-height bottom sentinel — only for measuring, never scrolled-to */}
        <div style={{ height: 0, flexShrink: 0 }} aria-hidden="true" />
      </div>

      {/* ── Send error ─────────────────────────────────────────── */}
      {sendError && <div className={styles.sendError}>{sendError}</div>}

      {/* ── Input ──────────────────────────────────────────────── */}
      <form className={styles.inputRow} onSubmit={handleSubmit}>
        <textarea
          className={styles.textarea}
          placeholder="Write a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={2000}
        />
        <button
          type="submit"
          className={styles.sendBtn}
          disabled={!draft.trim() || isSending}
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );

  if (variant === 'floating' && typeof document !== 'undefined') {
    return createPortal(panelContent, document.body);
  }

  return panelContent;
});

/**
 * Desktop launcher: a "Discussion" button that opens a small floating,
 * overlapping window. The panel only mounts (and joins the socket room) while
 * open.
 */
export function ActivityDiscussionFloating({ activityId }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {!open && (
        <button
          className={styles.launcherBtn}
          onClick={() => setOpen(true)}
        >
          <MessageCircle size={18} />
          <span>Discussion</span>
        </button>
      )}
      {open && (
        <ActivityDiscussion
          activityId={activityId}
          variant="floating"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export default ActivityDiscussion;
