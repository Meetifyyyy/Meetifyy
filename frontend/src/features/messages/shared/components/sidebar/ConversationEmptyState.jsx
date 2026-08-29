import { MessageSquare, Search } from '@shared/components/icons';
import styles from './ConversationList.module.css';

export default function ConversationEmptyState({
  searchVal = '',
  onClearSearch,
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

  return (
    <div className={styles.emptyStateContainer}>
      <div className={styles.emptyStateIconWrapper}>
        <MessageSquare size={24} />
      </div>
      <p className={styles.emptyStateDesc}>No messages</p>
    </div>
  );
}
