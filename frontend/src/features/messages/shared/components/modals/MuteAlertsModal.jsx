import { NotificationOff } from '@shared/components/icons';
import ConfirmModal from '@shared/components/modals/ConfirmModal';

/**
 * Asks before silencing a chat.
 *
 * Muting is easy to trigger by accident (a long-press or right-click on a row),
 * affects every notification from the chat, and leaves nothing on the row to say
 * it happened - so it confirms. Unmuting only brings notifications back and
 * never asks. A centred card on every screen size, like the other chat
 * confirmations.
 */
export default function MuteAlertsModal({ onConfirm, onCancel }) {
  return (
    <ConfirmModal
      title="Mute alerts"
      desc="You won't get notifications from this chat until you unmute it. New messages will still arrive."
      icon={<NotificationOff size={24} strokeWidth={2} />}
      confirmText="Mute"
      cancelText="Cancel"
      onCancel={onCancel}
      onConfirm={onConfirm}
      centered
    />
  );
}
