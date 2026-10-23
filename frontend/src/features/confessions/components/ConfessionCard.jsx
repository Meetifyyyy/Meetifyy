import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import Menu, { MenuItem, useMenu } from '@shared/components/ui/Menu';
import { Flag, MoreHorizontal, Trash2 } from '@shared/components/icons';
import { timeAgo } from '@shared/utils/time';
import HandleMark from './HandleMark';
import styles from './Confessions.module.css';

/** Short confessions are set as display type; long ones as reading text. */
function sizeOf(text) {
  const n = text.length;
  if (n <= 90) return 'xl';
  if (n <= 220) return 'lg';
  return 'md';
}

/**
 * One confession. Typography first: the words are the card, the name and time
 * sit quietly above, and the only control in view is Relate. Report and Delete
 * live in the overflow menu.
 */
function ConfessionCard({ confession, onRelate, onReport, onDelete, index = 0 }) {
  const { id, handle, content, createdAt, relateCount = 0, relatedByMe = false, isMine = false } = confession;
  const menu = useMenu();
  const bodyRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const size = sizeOf(content || '');

  // Only a long confession is cut; measure after layout so "Read more" only
  // appears when there is actually more.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    // Only reading-size text is clamped, so only it is worth a layout read.
    if (!el || expanded || size !== 'md') return;
    setClamped(el.scrollHeight > el.clientHeight + 2);
  }, [content, expanded, size]);

  const relate = useCallback(() => onRelate?.(id, !relatedByMe), [id, relatedByMe, onRelate]);

  return (
    <article
      className={styles.card}
      style={{ '--enter-delay': `${Math.min(index, 6) * 50}ms` }}
      aria-label={`Confession by @${handle}`}
    >
      <header className={styles.cardHead}>
        <HandleMark handle={handle} size={32} />
        <div className={styles.byline}>
          <span className={styles.handle}>@{handle}</span>
          {isMine && <span className={styles.youTag}>You</span>}
          <span className={styles.dot} aria-hidden="true">·</span>
          <time className={styles.time} dateTime={createdAt}>{timeAgo(createdAt)}</time>
        </div>
        <button {...menu.triggerProps} className={styles.more} aria-label="More options">
          <MoreHorizontal size={18} />
        </button>
        <Menu {...menu.menuProps} size="sm" ariaLabel="Confession options">
          {isMine ? (
            <MenuItem icon={Trash2} tone="danger" onSelect={() => onDelete?.(confession)} onClose={menu.close}>
              Delete
            </MenuItem>
          ) : (
            <MenuItem icon={Flag} tone="danger" onSelect={() => onReport?.(confession)} onClose={menu.close}>
              Report
            </MenuItem>
          )}
        </Menu>
      </header>

      <p
        ref={bodyRef}
        className={`${styles.body} ${expanded ? styles.bodyOpen : ''}`}
        data-size={size}
      >
        {content}
      </p>
      {clamped && !expanded && (
        <button type="button" className={styles.readMore} onClick={() => setExpanded(true)}>
          Read more
        </button>
      )}

      <footer className={styles.cardFoot}>
        <button
          type="button"
          className={`${styles.relate} ${relatedByMe ? styles.relateOn : ''}`}
          onClick={relate}
          aria-pressed={relatedByMe}
          aria-label={`${relatedByMe ? 'Remove relate' : 'Relate'}${relateCount ? `, ${relateCount}` : ''}`}
        >
          <RelateGlyph />
          <span>{relatedByMe ? 'Related' : 'Relate'}</span>
          {relateCount > 0 && <span className={styles.relateCount}>{relateCount}</span>}
        </button>
      </footer>
    </article>
  );
}

/** Two circles overlapping: "me too", drawn rather than borrowed from an icon set. */
function RelateGlyph() {
  return (
    <svg className={styles.relateGlyph} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </svg>
  );
}

export default memo(ConfessionCard);
