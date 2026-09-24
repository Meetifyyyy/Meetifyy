import { Search, Send, Plus } from '@shared/components/icons';
import styles from './ConversationList.module.css';

export default function ConversationEmptyState({
  searchVal = '',
  onClearSearch,
  onNewMessage,
}) {
  if (searchVal?.trim()) {
    return (
      <div className={styles.emptyStateContainer}>
        <div className={styles.emptyStateIconWrapper}>
          <Search size={22} />
        </div>
        <p className={styles.emptyStateDesc}>No messages found</p>
        {onClearSearch && (
          <button
            type="button"
            className={styles.emptyClearBtn}
            onClick={onClearSearch}
            style={{ marginTop: '0.75rem' }}
          >
            Clear search
          </button>
        )}
      </div>
    );
  }

  // No conversations yet: an Instagram-style "Your messages" invitation
  // rather than a bare "No messages" line.
  return (
    <div className={styles.inboxEmpty}>
      {/* Desktop: the chat pane beside this list already carries the full
          invitation, so the list only says it is empty. */}
      <p className={styles.inboxEmptyCompact}>No conversations yet</p>
      <div className={`${styles.inboxEmptyArt} ${styles.inboxEmptyFull}`} aria-hidden="true">
        <span className={styles.inboxEmptyRing}>
          <Send size={26} strokeWidth={1.6} />
        </span>
      </div>
      <h3 className={`${styles.inboxEmptyTitle} ${styles.inboxEmptyFull}`}>Your messages</h3>
      <p className={`${styles.inboxEmptyText} ${styles.inboxEmptyFull}`}>
        Send a private message to someone on campus, or start a group chat.
      </p>
      {onNewMessage && (
        <button type="button" className={`${styles.inboxEmptyCta} ${styles.inboxEmptyFull}`} onClick={onNewMessage}>
          <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
          Start a conversation
        </button>
      )}
    </div>
  );
}
