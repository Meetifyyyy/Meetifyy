import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { MessageCircle, X, Send, ChevronUp } from 'lucide-react';
import Avatar from '@shared/components/avatar/Avatar';
import { useAuth } from '@shared/context/AuthContext';
import { timeAgo } from '@shared/utils/time';
import { useActivityDiscussion } from '../hooks/useActivityDiscussion';
import styles from './ActivityDiscussion.module.css';

/**
 * Core discussion panel — a scrollable message area plus an input.
 * Used both as the desktop floating window body and the mobile inline box.
 */
export function ActivityDiscussion({ activityId, variant = 'inline', onClose, enabled = true }) {
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
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const prevScrollHeightRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const lastCountRef = useRef(0);

  // Track whether the user is pinned near the bottom (so realtime arrivals
  // auto-scroll, but reading older history is not interrupted).
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  // After older messages are prepended, keep the viewport anchored so the list
  // doesn't jump.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const count = messages.length;
    const grewAtTop = count > lastCountRef.current && !isNearBottomRef.current;
    if (grewAtTop && prevScrollHeightRef.current) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    } else if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
    lastCountRef.current = count;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [messages]);

  // Snap to bottom once the initial history has loaded.
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const handleLoadOlder = () => {
    const el = scrollRef.current;
    if (el) prevScrollHeightRef.current = el.scrollHeight;
    isNearBottomRef.current = false;
    loadMore();
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (!text || isSending) return;
    setDraft('');
    isNearBottomRef.current = true;
    try {
      await sendMessage(text);
    } catch {
      // Restore the draft so the user can retry.
      setDraft(text);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={`${styles.panel} ${variant === 'floating' ? styles.floating : styles.inline}`}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <MessageCircle size={16} />
          <span>Discussion</span>
        </div>
        {variant === 'floating' && onClose && (
          <button className={styles.iconBtn} onClick={onClose} aria-label="Close discussion">
            <X size={18} />
          </button>
        )}
      </div>

      <div className={styles.messages} ref={scrollRef} onScroll={handleScroll}>
        {hasMore && !isLoading && (
          <button className={styles.loadOlderBtn} onClick={handleLoadOlder} disabled={isFetchingMore}>
            <ChevronUp size={14} />
            {isFetchingMore ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}

        {isLoading ? (
          <div className={styles.stateMsg}>
            <span className={styles.spinner} />
          </div>
        ) : isError ? (
          <div className={styles.stateMsg}>Couldn’t load the discussion.</div>
        ) : messages.length === 0 ? (
          <div className={styles.emptyState}>
            <MessageCircle size={26} strokeWidth={1.5} />
            <p className={styles.emptyTitle}>No messages yet</p>
            <p className={styles.emptyDesc}>Start the conversation about this activity.</p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = String(m.userId) === String(currentUser?.id);
            return (
              <div key={m.id} className={`${styles.msgRow} ${isMe ? styles.msgRowMe : ''}`}>
                {!isMe && (
                  <Avatar src={m.user?.avatar} name={m.user?.displayName || m.user?.username} size="28px" />
                )}
                <div className={styles.msgBody}>
                  <div className={styles.msgMeta}>
                    <span className={styles.msgName}>{isMe ? 'You' : (m.user?.displayName || m.user?.username || 'Member')}</span>
                    <span className={styles.msgTime}>{timeAgo(m.createdAt)}</span>
                  </div>
                  <div className={`${styles.bubble} ${isMe ? styles.bubbleMe : ''} ${m.pending ? styles.bubblePending : ''}`}>
                    {m.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {sendError && <div className={styles.sendError}>{sendError}</div>}

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
        <button type="submit" className={styles.sendBtn} disabled={!draft.trim() || isSending} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

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
        <button className={styles.launcherBtn} onClick={() => setOpen(true)}>
          <MessageCircle size={18} />
          <span>Discussion</span>
        </button>
      )}
      {open && (
        <ActivityDiscussion activityId={activityId} variant="floating" onClose={() => setOpen(false)} />
      )}
    </>
  );
}

export default ActivityDiscussion;
