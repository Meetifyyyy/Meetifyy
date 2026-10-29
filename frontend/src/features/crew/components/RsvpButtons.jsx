import styles from './RsvpButtons.module.css';

/**
 * The floating "I'm in" / "I'm out" pair on the activity page.
 *
 * Both use the same 3D thumbs emoji the page has always used for "I'm in"
 * (/thumbs_up_3d.png); "I'm out" is that image turned upside down, so the two
 * are one family rather than a photo next to a font glyph. The chosen answer is
 * pressed (aria-pressed) and its emoji lifts, as "I'm in" did when joined.
 *
 * Not rendered for the host — the page shows them "Invite Friends" instead.
 */
export default function RsvpButtons({
  value,
  onChange,
  busy = false,
  joinDisabled = false,
  joinLabel = "I'm in",
}) {
  const isIn = value === 'in';
  const isOut = value === 'out';

  const press = (choice) => {
    // Re-pressing the current answer changes nothing, so it sends nothing.
    if (busy || value === choice) return;
    onChange?.(choice);
  };

  return (
    <div className={styles.group} role="group" aria-label="Are you going?" aria-busy={busy || undefined}>
      <button
        type="button"
        className={`${styles.btn} ${isIn ? styles.inSelected : ''}`}
        aria-pressed={isIn}
        disabled={busy || (joinDisabled && !isIn)}
        data-pending={busy ? 'true' : undefined}
        onClick={() => press('in')}
      >
        <span className={styles.content}>
          <img src="/thumbs_up_3d.png" alt="" className={`${styles.emoji} ${isIn ? styles.emojiLifted : ''}`} />
          <span>{joinLabel}</span>
        </span>
      </button>
      <button
        type="button"
        className={`${styles.btn} ${isOut ? styles.outSelected : ''}`}
        aria-pressed={isOut}
        disabled={busy}
        data-pending={busy ? 'true' : undefined}
        onClick={() => press('out')}
      >
        <span className={styles.content}>
          <img
            src="/thumbs_up_3d.png"
            alt=""
            className={`${styles.emoji} ${styles.emojiDown} ${isOut ? styles.emojiLifted : ''}`}
          />
          <span>I&apos;m out</span>
        </span>
      </button>
    </div>
  );
}
