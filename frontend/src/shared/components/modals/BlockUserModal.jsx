import { ShieldOff, Shield } from '@shared/components/icons';
import ConfirmModal from './ConfirmModal';

/**
 * Says what blocking (or unblocking) someone does, before it happens.
 *
 * A block is not a mute. It is mutual - neither person can message the other -
 * it removes the follow in both directions, ends any live match between them,
 * and the shared chat stays as read-only history. Nothing about the button that
 * opens this says any of that, and a block lands instantly, so it is asked first.
 * Unblocking is gentler but is not an undo: the follows removed by the block are
 * not restored, which is worth saying so nobody expects them back.
 */
export default function BlockUserModal({ name, isBlocked = false, onConfirm, onCancel }) {
  const who = name && String(name).trim() ? String(name).trim() : 'this person';

  if (isBlocked) {
    return (
      <ConfirmModal
        title={`Unblock ${who}?`}
        desc={`You'll be able to message each other again. Follows removed by the block aren't restored.`}
        icon={<Shield size={24} strokeWidth={2} />}
        confirmText="Unblock"
        cancelText="Cancel"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }

  return (
    <ConfirmModal
      title={`Block ${who}?`}
      desc={`Neither of you will be able to message the other, and you'll stop following each other. Your chat stays as read-only history. You can unblock ${who} at any time.`}
      icon={<ShieldOff size={24} strokeWidth={2} />}
      confirmText="Block"
      cancelText="Cancel"
      isDestructive
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
