import { useState, useMemo } from 'react';
import { Calendar, Search } from 'lucide-react';
import ActivityChatItem from './ActivityChatItem';
import ActivityChatContextMenu from './ActivityChatContextMenu';
import ConversationSkeleton from '../../../shared/components/skeletons/ConversationSkeleton';
import styles from '../../../shared/components/sidebar/ConversationList.module.css';

export default function ActivityChatList({
  conversations = [],
  activeChatId,
  onSelect,
  onMute,
  onPin,
  onMarkRead,
  isLoading,
}) {
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchVal, setSearchVal] = useState('');
  const [contextMenu, setContextMenu] = useState(null);

  const totalUnread = useMemo(() => {
    return (conversations || []).reduce((sum, c) => sum + (c.unread || 0), 0);
  }, [conversations]);

  const filteredConvs = useMemo(() => {
    return (conversations || [])
      .filter(c => {
        if (activeFilter === 'Unread') return c.unread > 0;
        return true;
      })
      .filter(c => {
        if (!searchVal.trim()) return true;
        const term = searchVal.toLowerCase();
        return (c.name || '').toLowerCase().includes(term) || (c.lastMsg || c.lastMessageText || '').toLowerCase().includes(term);
      })
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.timestamp || 0) - (a.timestamp || 0);
      });
  }, [conversations, activeFilter, searchVal]);

  const handleContextMenu = (e, convId) => {
    e.preventDefault();
    const conv = conversations.find(c => String(c.id) === String(convId));
    if (!conv) return;
    setContextMenu({ conv, x: e.clientX, y: e.clientY });
  };

  return (
    <div className={styles.msgConvList}>
      <div className={styles.headerWrapper}>
        <div className={styles.msgConvHeader}>
          <div className={styles.titleGroup}>
            <h2 className={styles.msgConvTitle}>Activity Chats</h2>
          </div>
        </div>

        <div className={styles.filterRow}>
          {['All', 'Unread'].map(filter => {
            const showCount = filter === 'Unread' && totalUnread > 0;
            return (
              <button 
                key={filter} 
                className={`${styles.filterChip} ${activeFilter === filter ? styles.activeFilter : ''}`} 
                onClick={() => setActiveFilter(filter)}
              >
                {filter}{showCount ? ` (${totalUnread > 99 ? '99+' : totalUnread})` : ''}
              </button>
            );
          })}
        </div>

        <div className={styles.searchRow}>
          <div className={styles.msgConvSearch}>
            <Search size={16} className={styles.searchIcon} />
            <input 
              type="text" 
              className={styles.msgSearchInput} 
              placeholder="Search activity chats…" 
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className={styles.msgConvScroll}>
        {isLoading ? (
          <>
            <ConversationSkeleton />
            <ConversationSkeleton />
            <ConversationSkeleton />
          </>
        ) : filteredConvs.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <p style={{ fontSize: '0.9rem', margin: 0 }}>{searchVal ? 'No activity chats match your search' : 'No activity chats yet'}</p>
          </div>
        ) : (
          filteredConvs.map((conv) => (
            <ActivityChatItem
              key={conv.id}
              conv={conv}
              activeChatId={activeChatId}
              onSelect={onSelect}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <ActivityChatContextMenu
          conv={contextMenu.conv}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onMarkRead={() => onMarkRead?.(contextMenu.conv.id)}
          onMute={() => onMute?.(contextMenu.conv.id, !contextMenu.conv.muted)}
          onPin={() => onPin?.(contextMenu.conv.id, !contextMenu.conv.pinned)}
        />
      )}
    </div>
  );
}
