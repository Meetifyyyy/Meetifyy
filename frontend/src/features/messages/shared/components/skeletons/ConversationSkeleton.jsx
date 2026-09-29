import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from './ConversationSkeleton.module.css';

// Varied a little so a column of them reads as a list, not a barcode.
const NAME_WIDTHS = ['46%', '58%', '38%', '52%', '42%', '60%', '48%'];
const PREVIEW_WIDTHS = ['78%', '64%', '84%', '70%', '58%', '76%', '66%'];

function ConversationSkeletonRow({ index }) {
  return (
    <div className={styles.row}>
      <Skeleton type="circle" width="48px" height="48px" />
      <div className={styles.info}>
        <Skeleton
          type="text"
          className={styles.line}
          width={NAME_WIDTHS[index % NAME_WIDTHS.length]}
          height="0.95rem"
          style={{ marginBottom: '0.45rem' }}
        />
        <Skeleton
          type="text"
          className={styles.line}
          width={PREVIEW_WIDTHS[index % PREVIEW_WIDTHS.length]}
          height="0.8rem"
          style={{ marginBottom: 0 }}
        />
      </div>
    </div>
  );
}

/**
 * Conversation-list placeholder: avatar + name + preview rows, with the same
 * geometry as the real rows (see the module stylesheet).
 *
 * `count` draws several rows under one status region; the default of one keeps
 * single-row callers unchanged. Seven fills a phone screen below the header.
 */
export default function ConversationSkeleton({ count = 1 }) {
  if (count <= 1) return <ConversationSkeletonRow index={0} />;
  return (
    <div role="status" aria-label="Loading conversations">
      {Array.from({ length: count }, (_, i) => (
        <ConversationSkeletonRow key={i} index={i} />
      ))}
    </div>
  );
}
