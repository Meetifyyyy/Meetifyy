import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useVotePoll } from '../../hooks/useVotePoll';
import {
  pollOptionText,
  pollOptionVotes,
  pollPercentages,
  votedOptionIndex,
} from '../../utils/pollView';
import styles from './PollCard.module.css';

/**
 * A post's poll.
 *
 * Before voting: one row per option with an empty ring, in the order the
 * author wrote them. After: each row is a bar of its share, the leader
 * stands out, and the viewer's choice carries a check. Results stay hidden
 * until the viewer votes, so they do not decide by the crowd.
 *
 * Voting is by option id, once (a second tap in the same frame does nothing,
 * the server keeps one vote a person and answers a repeat with the vote that
 * stands). The reveal animates only when it happens here: a poll already
 * voted on is drawn still, so scrolling the feed does not replay it.
 */

/** Counts 0 → `to` over `ms` when `run` turns on; otherwise shows `to`. */
function useCountUp(to, run, ms = 650) {
  const [value, setValue] = useState(run ? 0 : to);
  useEffect(() => {
    if (!run) {
      setValue(to);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(to * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, run, ms]);
  return value;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function ResultRow({ text, pct, votes, isMine, isLeader, index, animate }) {
  const shown = useCountUp(pct, animate);
  return (
    <li
      className={`${styles.row} ${styles.result}${isMine ? ` ${styles.mine}` : ''}${isLeader ? ` ${styles.leader}` : ''}`}
      style={{ '--share': pct / 100, '--i': index }}
      aria-label={`${text}: ${pct} percent, ${votes} ${votes === 1 ? 'vote' : 'votes'}${isMine ? ', your vote' : ''}`}
    >
      <span className={styles.bar} aria-hidden="true" />
      <span className={styles.mark} aria-hidden="true">
        {isMine && (
          <svg viewBox="0 0 16 16" width="16" height="16">
            <circle cx="8" cy="8" r="8" fill="currentColor" />
            <path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={styles.text}>{text}</span>
      <span className={styles.pct} aria-hidden="true">{shown}%</span>
    </li>
  );
}

export default function PollCard({ poll, postId }) {
  const { currentUser } = useAuth();
  const { mutate: vote, isPending } = useVotePoll();
  const inFlight = useRef(false);

  const options = Array.isArray(poll?.options) ? poll.options : [];
  const myIndex = votedOptionIndex(poll, currentUser?.id);
  const hasVoted = myIndex >= 0;
  const votes = options.map(pollOptionVotes);
  const totalVotes = Number.isFinite(Number(poll?.totalVotes))
    ? Number(poll.totalVotes)
    : votes.reduce((a, b) => a + b, 0);
  const pcts = pollPercentages(votes);
  const top = Math.max(0, ...votes);

  // Animate the reveal only when the vote happens in this card.
  const votedAtMount = useRef(hasVoted);
  const animate = hasVoted && !votedAtMount.current && !prefersReducedMotion();
  if (!hasVoted) inFlight.current = false;

  const choose = (option) => {
    if (hasVoted || isPending || inFlight.current || !option?.id) return;
    inFlight.current = true;
    vote(
      { postId, optionId: option.id, currentUserId: currentUser?.id },
      { onSettled: () => { inFlight.current = false; } },
    );
  };

  const footer = `${totalVotes.toLocaleString()} ${totalVotes === 1 ? 'vote' : 'votes'}`;

  if (hasVoted) {
    return (
      <div className={`${styles.poll} ${animate ? styles.revealing : ''}`}>
        <ul className={styles.list} aria-label="Poll results">
          {options.map((option, i) => (
            <ResultRow
              key={option?.id || i}
              text={pollOptionText(option)}
              pct={pcts[i]}
              votes={votes[i]}
              isMine={i === myIndex}
              isLeader={top > 0 && votes[i] === top}
              index={i}
              animate={animate}
            />
          ))}
        </ul>
        <p className={styles.footer}>
          {footer}
          <span className={styles.dot} aria-hidden="true">·</span>
          You voted
        </p>
      </div>
    );
  }

  return (
    <div className={styles.poll}>
      <div className={styles.list} role="group" aria-label="Poll: choose one">
        {options.map((option, i) => (
          <button
            key={option?.id || i}
            type="button"
            className={`${styles.row} ${styles.choice}`}
            onClick={() => choose(option)}
            disabled={isPending || !option?.id}
          >
            <span className={styles.ring} aria-hidden="true" />
            <span className={styles.text}>{pollOptionText(option)}</span>
          </button>
        ))}
      </div>
      <p className={styles.footer}>
        {footer}
        <span className={styles.dot} aria-hidden="true">·</span>
        Choose one to see results
      </p>
    </div>
  );
}
