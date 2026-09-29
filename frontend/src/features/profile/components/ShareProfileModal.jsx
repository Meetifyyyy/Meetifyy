import ShareSheet from '@shared/components/share/ShareSheet';
import { SHARE_KIND } from '@shared/lib/share/content';

/** Share dialog for a profile — see ShareSheet, which every kind shares. */
export default function ShareProfileModal({ isOpen, onClose, profileUser }) {
  return <ShareSheet isOpen={isOpen} onClose={onClose} kind={SHARE_KIND.PROFILE} entity={profileUser} />;
}
