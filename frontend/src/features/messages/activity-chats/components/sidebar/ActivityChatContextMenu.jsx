import { Pin, BellOff, BellRing, CheckCheck } from 'lucide-react';
import styles from './ActivityChatContextMenu.module.css';

export default function ActivityChatContextMenu({ conv, position, onClose, onMarkRead, onMute, onPin }) {
  if (!conv) return null;

  const handle = (fn) => (e) => {
    e.stopPropagation();
    fn?.();
    onClose?.();
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.menu} style={{ top: position?.y ?? 0, left: position?.x ?? 0 }}>
        {conv.unread > 0 && (
          <button className={styles.menuItem} onClick={handle(onMarkRead)}>
            <CheckCheck size={15} />
            Mark as read
          </button>
        )}
        <button className={styles.menuItem} onClick={handle(onPin)}>
          <Pin size={15} />
          {conv.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button className={styles.menuItem} onClick={handle(onMute)}>
          {conv.muted ? <BellRing size={15} /> : <BellOff size={15} />}
          {conv.muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
    </>
  );
}
