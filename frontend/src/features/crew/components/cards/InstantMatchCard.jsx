import { useInstantMatch } from '@features/instant-match/context/InstantMatchContext';
import { MatchMark } from '@features/instant-match/components/decor/Decor';
import { MeetScene } from '@features/instant-match/components/art/CampusMap';
import { ArrowRightIcon } from '@features/instant-match/components/art/icons';
import '@features/instant-match/styles/instant-match.css';
import styles from './InstantMatchCard.module.css';

/**
 * The crew page's entry point into Instant Match.
 *
 * One low Meetifyy card: the feature mark in a blue-tint square, a title and
 * one line of copy, and a "Match me" chip. A faded slice of the campus-map
 * scene sits behind the right edge as quiet texture. Short by design — it
 * sits above a column of activity cards and must not read as one.
 *
 * The whole strip is the button, and the tap opens the same sheet the floating
 * launcher does, so an in-flight search or a live match is picked up where the
 * user left it rather than restarted from here.
 */
export default function InstantMatchCard({ className = '' }) {
  const { openSheet, isVerified } = useInstantMatch();

  if (!isVerified) return null;

  return (
    <button
      type="button"
      className={`${styles.strip} ${className}`}
      onClick={openSheet}
      aria-label="Start an Instant Match"
    >
      <MeetScene variant="match" className={styles.scene} />

      <span className={styles.mark} aria-hidden="true">
        <MatchMark className={styles.markGlyph} />
      </span>

      <span className={styles.copy}>
        <span className={styles.title}>Instant Match</span>
        <span className={styles.lede}>Get paired with someone free right now.</span>
      </span>

      <span className={styles.cta}>
        Match me
        <ArrowRightIcon className={styles.ctaArrow} />
      </span>
    </button>
  );
}
