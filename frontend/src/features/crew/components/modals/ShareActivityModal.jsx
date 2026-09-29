import ShareSheet from '@shared/components/share/ShareSheet';
import { SHARE_KIND } from '@shared/lib/share/content';

/** Share dialog for an activity — see ShareSheet, which every kind shares. */
export default function ShareActivityModal({ isOpen, onClose, activity }) {
  return <ShareSheet isOpen={isOpen} onClose={onClose} kind={SHARE_KIND.ACTIVITY} entity={activity} />;
}
