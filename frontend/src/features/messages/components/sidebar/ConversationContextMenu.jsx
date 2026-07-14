import styles from './ConversationList.module.css';

export default function ConversationContextMenu({
  contextMenu,
  conversations,
  onMarkUnread,
  onTogglePin,
  onToggleMute,
  onDelete,
  onClose
}) {
  if (!contextMenu) return null;

  const targetConv = (conversations || []).find(c => c.id === contextMenu.convId);
  if (!targetConv) return null;

  return (
    <div 
      className={styles.contextMenu}
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={() => {
        onMarkUnread(contextMenu.convId, targetConv.unread === 0);
        onClose();
      }}>
        {targetConv.unread > 0 ? 'Mark as read' : 'Mark as unread'}
      </button>
      <button onClick={() => {
        onTogglePin(contextMenu.convId);
        onClose();
      }}>
        {targetConv.pinned ? 'Unpin chat' : 'Pin chat'}
      </button>
      <button onClick={() => {
        onToggleMute(contextMenu.convId);
        onClose();
      }}>
        {targetConv.muted ? 'Unmute notifications' : 'Mute notifications'}
      </button>
      <button className={styles.deleteBtn} onClick={() => {
        onDelete(contextMenu.convId);
        onClose();
      }}>
        Delete chat
      </button>
    </div>
  );
}
