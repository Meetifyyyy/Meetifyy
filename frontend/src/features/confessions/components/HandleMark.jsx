import styles from './Confessions.module.css';

/**
 * The stand-in for an avatar on an anonymous name: its first letter on one of
 * four quiet tints, picked from the name itself so the same name always gets
 * the same mark. Nothing here is derived from the account behind it.
 */
const TINTS = 4;

function tintOf(handle) {
  let h = 0;
  for (let i = 0; i < handle.length; i += 1) h = (h * 31 + handle.charCodeAt(i)) | 0;
  return Math.abs(h) % TINTS;
}

export default function HandleMark({ handle, size = 36 }) {
  const name = typeof handle === 'string' && handle ? handle : '?';
  return (
    <span
      className={styles.mark}
      data-tint={tintOf(name.toLowerCase())}
      style={{ '--mark-size': `${size}px` }}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
