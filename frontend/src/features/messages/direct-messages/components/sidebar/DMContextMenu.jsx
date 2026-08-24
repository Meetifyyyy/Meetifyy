import { useRef, useLayoutEffect, useState } from 'react';
import { Pin, BellOff, BellRing, Trash2, CheckCheck } from 'lucide-react';
import { computeMenuPosition } from '@features/messages/shared/components/MessageContextMenu';
import styles from './DMContextMenu.module.css';

export default function DMContextMenu({ conv, position, onClose, onMarkRead, onMute, onPin, onDelete }) {
  const menuRef = useRef(null);
  const [coords, setCoords] = useState({ x: -9999, y: -9999, ready: false });

  // The press point was written straight into `left`/`top`, so a right-click
  // near the right edge of the window put half the menu off screen. This is the
  // same clamp-and-flip the message context menu uses: measure the menu, offset
  // from the press, and flip to the other side when that would overflow.
  //
  // Declared before the early return so the hook order never changes between
  // an open and a closed menu.
  useLayoutEffect(() => {
    if (!menuRef.current || !position) return;
    setCoords({
      ...computeMenuPosition(
        position,
        { width: menuRef.current.offsetWidth || 180, height: menuRef.current.offsetHeight || 200 },
        { width: window.innerWidth, height: window.visualViewport?.height || window.innerHeight }
      ),
      ready: true,
    });
  }, [position?.x, position?.y, conv?.id, conv?.unread]);

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
      <div
        ref={menuRef}
        className={styles.menu}
        style={{
          top: `${coords.y}px`,
          left: `${coords.x}px`,
          opacity: coords.ready ? 1 : 0,
          visibility: coords.ready ? 'visible' : 'hidden',
        }}
      >
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
        <button className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={handle(onDelete)}>
          <Trash2 size={15} />
          Delete conversation
        </button>
      </div>
    </>
  );
}
