import { Pin, NotificationOff, NotificationOn, LogOut, CheckCheck } from '@shared/components/icons';
import Menu, { MenuItem, MenuSeparator } from '@shared/components/ui/Menu';

/**
 * The long-press / right-click menu on a group-chat row.
 *
 * Identical in shape to `DMContextMenu` — placement, backdrop and dismissal all
 * belong to `Menu`. The two differ only in their last action: a direct message
 * is deleted, a group is left.
 */
export default function GroupContextMenu({ conv, position, onClose, onMarkRead, onMute, onPin, onLeave }) {
  if (!conv) return null;

  // Both spellings: the server returns `muted`/`pinned`, some optimistic
  // writes historically set only the `is*` form.
  const isMuted = Boolean(conv.muted ?? conv.isMuted);
  const isPinned = Boolean(conv.pinned ?? conv.isPinned);

  return (
    <Menu open onClose={onClose} point={position} size="md" ariaLabel="Group options">
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
      <MenuItem icon={LogOut} tone="danger" onSelect={onLeave} onClose={onClose}>
        Leave group
      </MenuItem>
    </Menu>
  );
}
