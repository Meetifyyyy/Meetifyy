import { useRef, useLayoutEffect, useState } from 'react';
import { Reply, Copy, Forward, Trash2, Undo2 } from 'lucide-react';
import styles from './MessageContextMenu.module.css';

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

  if (!msg || !position) return null;

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

  const rawVisible = actions.filter(a => a.visible(msg));
  const visibleActions = rawVisible.filter((item, idx) => {
    if (!item.isSeparator) return true;
    if (idx === 0 || idx === rawVisible.length - 1) return false;
    if (rawVisible[idx - 1]?.isSeparator) return false;
    return true;
  });

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    // offsetWidth/offsetHeight, not getBoundingClientRect: the menu animates in
    // from `transform: scale(0.92)`, and getBoundingClientRect reports the
    // *scaled* box while that is still running. Positioning against a height
    // ~8% short placed the menu about 14px off, which is why a flipped menu
    // still landed on top of the message it belonged to. offsetHeight is the
    // untransformed layout size, which is what this maths wants.
    const width = menuRef.current.offsetWidth || 180;
    const height = menuRef.current.offsetHeight || 220;

    const gap = 12;
    const edgeMargin = 12;

    let x = position.x + gap;
    if (x + width > window.innerWidth - edgeMargin) {
      x = position.x - gap - width;
    }
    x = Math.max(edgeMargin, Math.min(x, window.innerWidth - width - edgeMargin));

    let y = position.y + gap;
    const vh = window.visualViewport?.height || window.innerHeight;
    if (y + height > vh - edgeMargin) {
      // Mirror the touch point the way the x axis does. This flipped the
      // already-offset y instead of the original, landing the menu `2 * gap`
      // too low so it sat over the message it belongs to.
      y = position.y - gap - height;
    }
    y = Math.max(edgeMargin, Math.min(y, vh - height - edgeMargin));

    setCoords({ x, y, ready: true });
  }, [position.x, position.y, visibleActions.length]);

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
