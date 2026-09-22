import { Reply, Copy, Forward, Trash2, Undo2 } from '@shared/components/icons';
import Menu, { MenuItem, MenuSeparator } from '@shared/components/ui/Menu';

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

  if (!msg || !position) return null;

  return (
    <Menu
      open
      onClose={onClose}
      point={position}
      size="md"
      ariaLabel="Message options"
    >
      {visibleActions.map((action) =>
        action.isSeparator ? (
          <MenuSeparator key={action.id} />
        ) : (
          <MenuItem
            key={action.id}
            icon={action.icon}
            tone={action.danger ? 'danger' : 'default'}
            onSelect={action.onClick}
          >
            {action.label}
          </MenuItem>
        ),
      )}
    </Menu>
  );
}
