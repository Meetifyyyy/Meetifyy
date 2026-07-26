import { Reply, Copy, Forward, Trash2, Undo2 } from 'lucide-react';
import styles from './MessageContextMenu.module.css';

export default function MessageContextMenu({
  msg,
  position,
  onClose,
  onReply,
  onCopy,
  onForward,
  onDeleteForMe,
  onUnsendRequest
}) {
  if (!msg || !position) return null;

  const isTemp = (m) => m && m.id && (String(m.id).startsWith('temp-') || String(m.id).startsWith('temp_'));

  const actions = [
    {
      id: 'reply',
      label: 'Reply',
      icon: Reply,
      visible: (m) => !isTemp(m),
      onClick: () => {
        onReply(msg);
        onClose();
      }
    },
    {
      id: 'copy',
      label: 'Copy',
      icon: Copy,
      visible: (m) => Boolean(m.text && typeof m.text === 'string' && m.text.trim().length > 0 && m.state !== 'UNSENT'),
      onClick: () => {
        onCopy(msg);
        onClose();
      }
    },
    {
      id: 'forward',
      label: 'Forward',
      icon: Forward,
      visible: (m) => m.state !== 'UNSENT' && !isTemp(m),
      onClick: () => {
        onForward(msg);
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
        onDeleteForMe(msg);
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
        if (m.from !== 'me') return false;
        if (m.state === 'UNSENT') return false;
        
        const now = new Date().getTime();
        const msgTime = new Date(m.createdAt).getTime();
        const diffMins = (now - msgTime) / (1000 * 60);
        return diffMins <= 10;
      },
      onClick: () => {
        onUnsendRequest(msg);
        onClose();
      }
    }
  ];

  const visibleActions = actions.filter(a => a.visible(msg));

  // Compute position coordinates staying inside viewport bounds
  const x = Math.min(Math.max(12, position.x), window.innerWidth - 180);
  const y = Math.min(Math.max(12, position.y), window.innerHeight - 240);

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
        className={styles.contextMenu} 
        style={{ top: `${y}px`, left: `${x}px` }}
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
