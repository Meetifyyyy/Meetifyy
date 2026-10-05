import { UserX } from '@shared/components/icons';
import ConfirmModal from './ConfirmModal';

/**
 * Asked before someone is unfollowed.
 *
 * A single tap on "Following" removes the follow immediately, and on a phone that
 * button sits next to things people tap constantly, so it was easy to drop a
 * follow without meaning to and not notice. The question names the account and
 * says what changes (their posts leave the feed) and that it is not final.
 */
export default function UnfollowModal({ username, onConfirm, onCancel }) {
  const handle = username ? `@${String(username).replace(/^@/, '')}` : 'this account';

  return (
    <ConfirmModal
      title={`Unfollow ${handle}?`}
      desc={`Their posts will no longer appear in your feed. You can follow ${username ? handle : 'them'} again at any time.`}
      icon={<UserX size={24} strokeWidth={2} />}
      confirmText="Unfollow"
      cancelText="Cancel"
      isDestructive
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
