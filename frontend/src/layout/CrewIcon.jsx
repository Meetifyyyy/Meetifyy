import { Activity } from '@shared/components/icons';
import styles from './CrewIcon.module.css';

/**
 * The Crew tab's icon, shared by the left sidebar and the bottom navigation so
 * the two cannot drift apart.
 *
 * It is the same glyph the search page uses for its Activities filter.
 * Hugeicons ships it as a single stroke icon with no solid counterpart, so the
 * active state is that glyph filled with currentColor rather than a second
 * drawing -- with the eyes knocked back out, see the stylesheet.
 */
export const CrewOutline = ({ className = '', size = 22, ...props }) => (
  <Activity {...props} size={size} className={`${styles.crew} ${className}`.trim()} />
);

export const CrewSolid = ({ className = '', size = 22, ...props }) => (
  <Activity
    {...props}
    size={size}
    fill="currentColor"
    className={`${styles.crew} ${styles.solid} ${className}`.trim()}
  />
);
