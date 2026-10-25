import { memo } from 'react';
import styles from './Confessions.module.css';

/**
 * The avatar an anonymous name wears: the name's first letter on a coloured
 * circle. The colour is a hash of the handle, so every name keeps the same
 * avatar on every device without anything being stored, and nothing about it
 * comes from the account behind the name.
 */
const COLOURS = [
  '#5b45f0', // violet
  '#e0522f', // coral
  '#0f9488', // teal
  '#c27c00', // amber
  '#d6337f', // pink
  '#2563eb', // blue
  '#3f8a1d', // green
  '#9333ea', // purple
  '#e11d48', // red
  '#0891b2', // cyan
];

/** FNV-1a: a stable, well-mixed number for a string. */
function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The avatar a handle gets: its initial and background colour. */
export function avatarFor(handle) {
  const key = String(handle).toLowerCase();
  const letter = key.replace(/^[^a-z0-9]+/, '').charAt(0).toUpperCase();
  return { letter: letter || '?', bg: COLOURS[hashOf(`bg:${key}`) % COLOURS.length] };
}

/**
 * `size` is the circle's diameter in px. With no `handle` (still loading) it
 * is an empty circle.
 */
function HandleMark({ handle, size = 36 }) {
  const avatar = handle ? avatarFor(handle) : null;
  return (
    <span
      className={styles.mark}
      style={{
        '--mark-size': `${size}px`,
        ...(avatar ? { '--mark-bg': avatar.bg } : {}),
      }}
      aria-hidden="true"
    >
      {avatar?.letter}
    </span>
  );
}

export default memo(HandleMark);
