import { memo, useLayoutEffect, useRef, useState } from 'react';
import Menu, { MenuItem, useMenu } from '@shared/components/ui/Menu';
import { Flag, MoreHorizontal, Trash2 } from '@shared/components/icons';
import { timeAgo } from '@shared/utils/time';
import HandleMark from './HandleMark';
import ConfessionReactions from './ConfessionReactions';
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
 * sit quietly above, and the action row below holds React and Share. Report
 * and Delete live in the overflow menu.
 *
 * `highlight` marks the one a link opened (from a chat, say).
 */
function ConfessionCard({ confession, onReact, onShare, onReport, onDelete, enter = false, highlight = false }) {
  const { handle, content, createdAt, isMine = false } = confession;
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

  const cardClass = [styles.card, enter && styles.cardEnter, highlight && styles.cardHighlight].filter(Boolean).join(' ');

  return (
    <article className={cardClass} aria-label={`Confession by @${handle}`}>
      <header className={styles.cardHead}>
        <HandleMark handle={handle} size={40} />
        <div className={styles.byline}>
          <span className={styles.bylineName}>
            <span className={styles.handle}>@{handle}</span>
          </span>
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
        <ConfessionReactions confession={confession} onReact={onReact} />
        {onShare && (
          <button
            type="button"
            className={styles.share}
            onClick={() => onShare(confession)}
            aria-label="Share confession"
          >
            <ShareGlyph />
            <span>Share</span>
          </button>
        )}
      </footer>
    </article>
  );
}

/** A paper plane: "send to someone", as the share action in chats. */
function ShareGlyph() {
  return (
    <svg className={styles.shareGlyph} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.5 3.5 10.6 13.4" />
      <path d="M21.5 3.5 14.8 20.6l-4.2-7.2-7.1-4.1z" />
    </svg>
  );
}

export default memo(ConfessionCard);
