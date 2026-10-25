import { useNavigate } from 'react-router-dom';
import { EyeOff, RefreshCw } from '@shared/components/icons';
import { useConfession } from '@shared/hooks/useConfessions';
import { CONFESSION_REACTIONS, describeReactions, formatCount, reactionStateOf, topReactions } from '@shared/lib/confessionReactions';
import { timeAgo } from '@shared/utils/time';
import HandleMark from '@features/confessions/components/HandleMark';
import styles from './SharedConfessionPreview.module.css';

/**
 * A confession shared into a chat.
 *
 * The message holds the confession's id and nothing else (the server strips
 * anything more), so this asks for the confession itself, as this reader, every
 * time it is shown: the server answers only while the confession is visible and
 * only to students on its campus. Deleted, taken down or from another campus,
 * it is "no longer available", with no text, name or hint of which it was.
 *
 * The author appears as their anonymous handle and its generated mark, exactly
 * as on the Confessions page; nothing here can lead to their account. The
 * card looks the same whoever sent it, like the other shared cards.
 */
export function SharedConfessionPreview({ confessionId }) {
  const navigate = useNavigate();
  const { confession, isLoading, isGone, isError, refetch } = useConfession(confessionId);

  if (isLoading) {
    return (
      <div className={styles.card} aria-busy="true" aria-label="Loading confession">
        <div className={styles.head}>
          <span className={styles.skMark} />
          <span className={styles.skLines}>
            <span className={styles.skBar} style={{ width: '46%' }} />
            <span className={styles.skBar} style={{ width: '30%', height: 8 }} />
          </span>
        </div>
        <span className={styles.skBar} style={{ width: '94%' }} />
        <span className={styles.skBar} style={{ width: '72%' }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles.notice} role="alert">
        <span>Couldn’t load this confession.</span>
        <button
          type="button"
          className={styles.retry}
          onClick={(e) => {
            e.stopPropagation();
            refetch();
          }}
        >
          <RefreshCw size={13} aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  if (isGone || !confession) {
    return (
      <div className={styles.notice} role="note">
        <EyeOff size={14} aria-hidden="true" />
        <span>This confession is no longer available</span>
      </div>
    );
  }

  const state = reactionStateOf(confession);
  const top = topReactions(state, CONFESSION_REACTIONS.length);
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/campus/confessions/${encodeURIComponent(confession.id)}`, { state: { from: 'chat' } });
  };

  return (
    <div
      className={`${styles.card} ${styles.clickable}`}
      role="link"
      tabIndex={0}
      aria-label={`Confession by @${confession.handle}. Open`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') open(e);
      }}
    >
      <div className={styles.head}>
        <HandleMark handle={confession.handle} size={34} />
        <span className={styles.byline}>
          <span className={styles.handle}>@{confession.handle}</span>
          <span className={styles.meta}>
            Anonymous confession · <time dateTime={confession.createdAt}>{timeAgo(confession.createdAt)}</time>
          </span>
        </span>
      </div>

      <p className={styles.text}>{confession.content}</p>

      {state.reactionCount > 0 && (
        <div className={styles.foot} title={describeReactions(state)}>
          <span className={styles.stack} aria-hidden="true">
            {top.map((r) => <span key={r.key} className={styles.stackItem}>{r.emoji}</span>)}
          </span>
          <span className={styles.count} aria-hidden="true">{formatCount(state.reactionCount)}</span>
          <span className={styles.srOnly}>{describeReactions(state)}</span>
        </div>
      )}
    </div>
  );
}

export default SharedConfessionPreview;
