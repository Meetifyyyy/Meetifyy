import { Pin, BellOff, BellRing, LogOut, CheckCheck } from 'lucide-react';
import styles from './GroupContextMenu.module.css';

export default function GroupContextMenu({ conv, position, onClose, onMarkRead, onMute, onPin, onLeave }) {
  if (!conv) return null;

  // Read both spellings: the server returns `muted`/`pinned`, while some
  // optimistic writes historically only set the `is*` form. Falling back
  // keeps the label honest either way.
  const isMuted = Boolean(conv.muted ?? conv.isMuted);
  const isPinned = Boolean(conv.pinned ?? conv.isPinned);

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
          {isPinned ? 'Unpin' : 'Pin'}
        </button>
        <button className={styles.menuItem} onClick={handle(onMute)}>
          {isMuted ? <BellRing size={15} /> : <BellOff size={15} />}
          {isMuted ? 'Unmute alerts' : 'Mute alerts'}
        </button>
        <div className={styles.divider} />
        <button className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={handle(onLeave)}>
          <LogOut size={15} />
          Leave group
        </button>
      </div>
    </>
  );
}
