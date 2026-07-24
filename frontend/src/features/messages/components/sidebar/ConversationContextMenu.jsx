import styles from './ConversationList.module.css';

export default function ConversationContextMenu({
  contextMenu,
  conversations,
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
        onTogglePin(contextMenu.convId, targetConv.pinned);
        onClose();
      }}>
        {targetConv.pinned ? 'Unpin chat' : 'Pin chat'}
      </button>
      <button onClick={() => {
        onToggleMute(contextMenu.convId, targetConv.muted);
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
