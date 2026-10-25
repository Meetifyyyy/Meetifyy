import { useState } from 'react';
import { formatCount } from '@shared/lib/confessionReactions';
import styles from './RollingCount.module.css';

/**
 * A number that rolls when it changes: the new value slides in from below
 * when it went up, from above when it went down. Only the changed number
 * animates, with a transform and opacity on one span; the first value shown
 * does not move at all.
 */
export default function RollingCount({ value, format = formatCount }) {
  const [shown, setShown] = useState(value);
  const [direction, setDirection] = useState(null);
  if (shown !== value) {
    setDirection(value > shown ? 'up' : 'down');
    setShown(value);
  }
  return (
    <span className={styles.roll}>
      <span key={value} className={direction ? styles[direction] : undefined}>{format(value)}</span>
    </span>
  );
}
