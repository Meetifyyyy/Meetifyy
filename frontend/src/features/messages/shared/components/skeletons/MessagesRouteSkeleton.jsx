import { useParams } from 'react-router-dom';
import ConversationSkeleton from './ConversationSkeleton';
import layoutStyles from '../../../components/layout/MessagesLayout.module.css';
import styles from './ConversationSkeleton.module.css';

/**
 * Suspense fallback for the Messages route while its lazy chunk loads.
 *
 * Draws the same frame MessagesLayout does (page + container, so the container
 * query that switches to the one-column phone layout applies here too), the
 * real "Messages" title, and the conversation-list skeleton that the layout
 * itself shows while the list query is pending, so chunk-load and data-load
 * read as one continuous state.
 *
 * Deliberately small: it must not import MessagesLayout or anything heavy, or
 * the Messages chunk would be pulled into the main bundle.
 *
 * A deep link straight into a thread renders nothing here: on a phone the
 * screen that appears is the thread, not the list, and drawing the list first
 * would show the wrong screen for a moment.
 */
export default function MessagesRouteSkeleton() {
  const { param1, param2 } = useParams();
  if (param1 || param2) return null;

  return (
    <div className={layoutStyles.page}>
      <div className={layoutStyles.messagesLayout}>
        <div className={styles.list}>
          <div className={styles.header}>
            <h2 className={styles.title}>Messages</h2>
          </div>
          <div className={styles.searchRowSpace} />
          <ConversationSkeleton count={7} />
        </div>
      </div>
    </div>
  );
}
