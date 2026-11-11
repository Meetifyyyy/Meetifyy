import { useParams } from 'react-router-dom';
import ConversationSkeleton from './ConversationSkeleton';
import layoutStyles from '../../../components/layout/MessagesLayout.module.css';
import sidebarStyles from '../sidebar/ConversationList.module.css';
import { MessageSquarePlus, Search } from '@shared/components/icons';

/**
 * Suspense fallback for the Messages route while its lazy chunk loads.
 *
 * Draws the same frame MessagesLayout does (page + container, so the container
 * query that switches to the one-column phone layout applies here too), the
 * real header (title, search box, New Message button), and the
 * conversation-list skeleton that the layout
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
        <div className={sidebarStyles.msgConvList}>
          {/* The real header, with the list's own classes: the title, the
              search box and the New Message button sit exactly where the
              loaded screen draws them, so nothing moves when it takes over.
              Visible but not yet usable until then. */}
          <div className={sidebarStyles.headerWrapper}>
            <div className={sidebarStyles.msgConvHeader}>
              <div className={sidebarStyles.titleGroup}>
                <h2 className={sidebarStyles.msgConvTitle}>Messages</h2>
              </div>
            </div>
            <div className={sidebarStyles.searchRow} inert="">
              <div className={sidebarStyles.msgConvSearch}>
                <Search size={16} className={sidebarStyles.searchIcon} />
                <input
                  type="text"
                  className={sidebarStyles.msgSearchInput}
                  placeholder="Search conversations..."
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </div>
              <span className={sidebarStyles.msgNewBtn} aria-hidden="true">
                <MessageSquarePlus size={20} />
              </span>
            </div>
          </div>
          <div className={sidebarStyles.msgConvScroll}>
            <ConversationSkeleton count={7} />
          </div>
        </div>
      </div>
    </div>
  );
}
