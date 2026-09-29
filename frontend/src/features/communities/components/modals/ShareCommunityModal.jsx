import ShareSheet from '@shared/components/share/ShareSheet';
import { SHARE_KIND } from '@shared/lib/share/content';

/** Share dialog for a community — see ShareSheet, which every kind shares. */
export default function ShareCommunityModal({ isOpen, onClose, community }) {
  return <ShareSheet isOpen={isOpen} onClose={onClose} kind={SHARE_KIND.COMMUNITY} entity={community} />;
}
