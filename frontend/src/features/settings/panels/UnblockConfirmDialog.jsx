import ConfirmModal from '@shared/components/modals/ConfirmModal';
import { ShieldOff } from '@shared/components/icons';

/**
 * Confirmation shown before any unblock request is sent.
 * Follows the standard confirmation modal UI (like Delete Post, Delete Comment, etc.)
 */
export default function UnblockConfirmDialog({ contact, onConfirm, onCancel, isSubmitting }) {
  if (!contact) return null;

  const name = contact.isDeleted ? 'Deleted Account' : (contact.displayName || contact.username || 'this user');

  return (
    <ConfirmModal
      title={`Unblock ${name}?`}
      desc="They will be able to see your profile and content again."
      visible={Boolean(contact)}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmText={isSubmitting ? 'Unblocking…' : 'Unblock'}
      cancelText="Cancel"
      isDestructive={false}
      icon={<ShieldOff size={24} strokeWidth={2} />}
    />
  );
}
