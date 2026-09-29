import ShareSheet from '@shared/components/share/ShareSheet';
import { SHARE_KIND } from '@shared/lib/share/content';

/** Share dialog for a post — see ShareSheet, which every kind shares. */
export default function SharePostModal({ isOpen, onClose, post, author }) {
  return <ShareSheet isOpen={isOpen} onClose={onClose} kind={SHARE_KIND.POST} entity={post} author={author} />;
}
