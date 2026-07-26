import { useState, useMemo } from 'react';
import { MessageSquarePlus, Search } from 'lucide-react';
import DMItem from './DMItem';
import DMContextMenu from './DMContextMenu';
import NewMessageModal from '../../../shared/components/modals/NewMessageModal';
import ConversationSkeleton from '../../../shared/components/skeletons/ConversationSkeleton';
import styles from '../../../shared/components/sidebar/ConversationList.module.css';

export default function DMList({
  conversations = [],
  activeChatId,
  onSelect,
  onMute,
  onPin,
  onDelete,
  onMarkRead,
  isLoading,
  onStartChat,
}) {
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchVal, setSearchVal] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
            <h2 className={styles.msgConvTitle}>Direct Messages</h2>
          </div>
          <button className={styles.msgNewBtn} title="New Direct Message" onClick={() => setIsModalOpen(true)}>
            <MessageSquarePlus size={20} />
          </button>
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
              placeholder="Search conversations…" 
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
            <p style={{ fontSize: '0.9rem', margin: 0 }}>{searchVal ? 'No direct messages match your search' : 'No direct messages yet'}</p>
          </div>
        ) : (
          filteredConvs.map((conv) => (
            <DMItem
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
        <DMContextMenu
          conv={contextMenu.conv}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onMarkRead={() => onMarkRead?.(contextMenu.conv.id)}
          onMute={() => onMute?.(contextMenu.conv.id, !contextMenu.conv.muted)}
          onPin={() => onPin?.(contextMenu.conv.id, !contextMenu.conv.pinned)}
          onDelete={() => onDelete?.(contextMenu.conv.id)}
        />
      )}

      {isModalOpen && (
        <NewMessageModal
          onClose={() => setIsModalOpen(false)}
          onStartChat={(user) => {
            setIsModalOpen(false);
            onStartChat?.(user);
          }}
        />
      )}
    </div>
  );
}
