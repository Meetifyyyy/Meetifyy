import { useRef, useLayoutEffect, useState } from 'react';
import { Reply, Copy, Forward, Trash2, Undo2 } from 'lucide-react';
import styles from './MessageContextMenu.module.css';

export const MENU_GAP = 12;
export const MENU_EDGE_MARGIN = 12;

/**
 * Where to put the message context menu for a press at `position`.
 *
 * `size` must be the menu's *untransformed* layout size (offsetWidth /
 * offsetHeight). The menu animates in from `transform: scale(0.92)`, and
 * getBoundingClientRect reports the scaled box while that is running -- reading
 * it there measured a height ~8% short and placed the menu ~14px off, which is
 * how a flipped menu ended up on top of the message it belonged to.
 *
 * Both axes mirror the press point the same way: offset by MENU_GAP on the
 * near side, and when that would overflow, flip to `position - gap - extent`.
 * The vertical case used to flip the already-offset value instead of the press
 * point, leaving it 2 * MENU_GAP too low.
 */
export function computeMenuPosition(position, size, viewport) {
  const { width, height } = size;
  const gap = MENU_GAP;
  const edge = MENU_EDGE_MARGIN;

  let x = position.x + gap;
  if (x + width > viewport.width - edge) x = position.x - gap - width;
  x = Math.max(edge, Math.min(x, viewport.width - width - edge));

  let y = position.y + gap;
  if (y + height > viewport.height - edge) y = position.y - gap - height;
  y = Math.max(edge, Math.min(y, viewport.height - height - edge));

  return { x, y };
}

export default function MessageContextMenu({
  msg,
  position,
  currentUser,
  onClose,
  onReply,
  onCopy,
  onForward,
  onDeleteForMe,
  onUnsend,
  onUnsendRequest
}) {
  const menuRef = useRef(null);
  const [coords, setCoords] = useState({ x: -9999, y: -9999, ready: false });

  // No early return above this point: useLayoutEffect below must run on every
  // render, or React loses hook order the first time the menu closes.
  const isTemp = (m) => m && m.id && (String(m.id).startsWith('temp-') || String(m.id).startsWith('temp_'));
  const isUnavailableMedia = (m) => Boolean(m && (m.isMediaUnavailable || m.mediaError));

  const actions = [
    {
      id: 'reply',
      label: 'Reply',
      icon: Reply,
      visible: (m) => !isTemp(m) && !isUnavailableMedia(m) && m.state !== 'UNSENT' && !m.isUnsent && m.text !== 'This message was unsent',
      onClick: () => {
        onReply?.(msg);
        onClose();
      }
    },
    {
      id: 'copy',
      label: 'Copy',
      icon: Copy,
      visible: (m) => Boolean(m.text && typeof m.text === 'string' && m.text.trim().length > 0 && m.state !== 'UNSENT'),
      onClick: () => {
        onCopy?.(msg);
        onClose();
      }
    },
    {
      id: 'forward',
      label: 'Forward',
      icon: Forward,
      visible: (m) => m.state !== 'UNSENT' && !isTemp(m) && !isUnavailableMedia(m),
      onClick: () => {
        onForward?.(msg);
        onClose();
      }
    },
    {
      id: 'sep',
      isSeparator: true,
      visible: () => true
    },
    {
      id: 'delete_for_me',
      label: 'Delete for me',
      icon: Trash2,
      danger: true,
      visible: (m) => !isTemp(m),
      onClick: () => {
        onDeleteForMe?.(msg);
        onClose();
      }
    },
    {
      id: 'unsend',
      label: 'Unsend',
      icon: Undo2,
      danger: true,
      visible: (m) => {
        if (isTemp(m)) return false;
        const isOwn = m.from === 'me' || (currentUser && (String(m.senderId) === String(currentUser.id) || String(m.userId) === String(currentUser.id) || String(m.fromUserId) === String(currentUser.id) || String(m.sender?.id) === String(currentUser.id)));
        if (!isOwn) return false;
        if (m.state === 'UNSENT' || m.isUnsent || m.text === 'This message was unsent') return false;
        return true;
      },
      onClick: () => {
        const handler = onUnsend || onUnsendRequest;
        handler?.(msg);
        onClose();
      }
    }
  ];

  const rawVisible = msg ? actions.filter(a => a.visible(msg)) : [];
  const visibleActions = rawVisible.filter((item, idx) => {
    if (!item.isSeparator) return true;
    if (idx === 0 || idx === rawVisible.length - 1) return false;
    if (rawVisible[idx - 1]?.isSeparator) return false;
    return true;
  });

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    setCoords({
      ...computeMenuPosition(
        position,
        { width: menuRef.current.offsetWidth || 180, height: menuRef.current.offsetHeight || 220 },
        { width: window.innerWidth, height: window.visualViewport?.height || window.innerHeight }
      ),
      ready: true,
    });
  }, [position?.x, position?.y, visibleActions.length]);

  // Moved below the hook, which is the whole point: same rendered output,
  // but the hook count no longer changes between renders.
  if (!msg || !position) return null;


  return (
    <div 
      className={styles.contextMenuOverlay} 
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={onClose}
    >
      <div 
        ref={menuRef}
        className={styles.contextMenu} 
        style={{ 
          top: `${coords.y}px`, 
          left: `${coords.x}px`,
          opacity: coords.ready ? 1 : 0,
          visibility: coords.ready ? 'visible' : 'hidden',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {visibleActions.map((action) => {
          if (action.isSeparator) {
            return <div key={action.id} className={styles.contextMenuDivider} />;
          }

          const IconComp = action.icon;
          return (
            <button
              key={action.id}
              className={`${styles.contextMenuItem} ${action.danger ? styles.danger : ''}`}
              onClick={action.onClick}
            >
              <IconComp size={15} className={styles.actionIcon} />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
