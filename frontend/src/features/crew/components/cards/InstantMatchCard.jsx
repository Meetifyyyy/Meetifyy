import { useInstantMatch } from '@features/instant-match/context/InstantMatchContext';
import { Bolt, Starburst } from '@features/instant-match/components/decor/Decor';
import '@features/instant-match/styles/instant-match.css';
import styles from './InstantMatchCard.module.css';

/**
 * The crew page's entry point into Instant Match.
 *
 * One low strip: the bolt mark, a line of display type, a line of copy, and the
 * action, with a striped riso wedge running off the right edge. Short by
 * design — it sits above a column of activity cards and must not read as one —
 * and deliberately unlike the Create Activity card (tall, portrait, blue),
 * because the two start different things.
 *
 * The whole strip is the button, and the tap opens the same sheet the floating
 * launcher does, so an in-flight search or a live match is picked up where the
 * user left it rather than restarted from here.
 */
export default function InstantMatchCard({ className = '' }) {
  const { openSheet } = useInstantMatch();

  return (
    <button
      type="button"
      className={`${styles.strip} ${className}`}
      onClick={openSheet}
      aria-label="Start an Instant Match"
    >
      <span className={styles.wedge} aria-hidden="true" />
      <Starburst className={styles.star} points={4} />

      <span className={styles.mark}>
        <span className={styles.markRing} aria-hidden="true" />
        <Bolt className={styles.markBolt} />
      </span>

      <span className={styles.copy}>
        <span className={styles.title}>Instant Match</span>
        <span className={styles.lede}>Get paired with someone free right now.</span>
      </span>

      <span className={styles.cta}>
        Match me
        <svg className={styles.ctaArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </span>
    </button>
  );
}
