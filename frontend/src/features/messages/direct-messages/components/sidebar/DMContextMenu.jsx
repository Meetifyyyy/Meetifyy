import { Pin, NotificationOff, NotificationOn, Trash2, CheckCheck } from '@shared/components/icons';
import Menu, { MenuItem, MenuSeparator } from '@shared/components/ui/Menu';

/**
 * The long-press / right-click menu on a direct-message row.
 *
 * Placement, the viewport clamp, the backdrop and dismissal all belong to
 * `Menu` now. This file used to own a measure-and-clamp layout effect and a
 * backdrop of its own, and imported `computeMenuPosition` from
 * `MessageContextMenu` — a sibling feature component that had quietly become a
 * utility module. That helper lives in `@shared/components/ui/Menu` now and
 * nothing imports across features for it.
 */
export default function DMContextMenu({ conv, position, onClose, onMarkRead, onMute, onPin, onDelete }) {
  if (!conv) return null;

  // Read both spellings: the server returns `muted`/`pinned`, while some
  // optimistic writes historically only set the `is*` form. Falling back
  // keeps the label honest either way.
  const isMuted = Boolean(conv.muted ?? conv.isMuted);
  const isPinned = Boolean(conv.pinned ?? conv.isPinned);

  return (
    <Menu open onClose={onClose} point={position} size="md" ariaLabel="Conversation options">
      {conv.unread > 0 && (
        <MenuItem icon={CheckCheck} onSelect={onMarkRead} onClose={onClose}>
          Mark as read
        </MenuItem>
      )}
      <MenuItem icon={Pin} onSelect={onPin} onClose={onClose}>
        {isPinned ? 'Unpin' : 'Pin'}
      </MenuItem>
      <MenuItem
        icon={isMuted ? NotificationOn : NotificationOff}
        onSelect={onMute}
        onClose={onClose}
      >
        {isMuted ? 'Unmute alerts' : 'Mute alerts'}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={Trash2} tone="danger" onSelect={onDelete} onClose={onClose}>
        Delete conversation
      </MenuItem>
    </Menu>
  );
}
