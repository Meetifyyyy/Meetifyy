import { memo } from 'react';
import styles from './Confessions.module.css';

/**
 * The avatar an anonymous name wears: a small pixel creature, its colour and
 * its background each picked from the name. "Random" in the sense that the
 * three choices are independent hashes of the handle, so every name keeps the
 * same avatar on every device without anything being stored, and nothing about
 * it comes from the account behind the name.
 *
 * Sprites, one character per cell:
 *   #  body (the ink colour)   W  white (eyes, spots)   P  dark (pupils, mouth)
 */
const SPRITES = {
  ghost: [
    '....####....',
    '..########..',
    '.##########.',
    '.#WWW##WWW#.',
    '##WPP##WPP##',
    '##WPP##WPP##',
    '##WWW##WWW##',
    '############',
    '############',
    '############',
    '##.##..##.##',
    '#...#..#...#',
  ],
  invader: [
    '..#......#..',
    '...#....#...',
    '..########..',
    '.##WW##WW##.',
    '.##WP##WP##.',
    '############',
    '#.########.#',
    '#.#......#.#',
    '...##..##...',
  ],
  cat: [
    '.#........#.',
    '.##......##.',
    '.###....###.',
    '.##########.',
    '############',
    '##WW####WW##',
    '##WP####WP##',
    '############',
    '#####PP#####',
    '.##########.',
    '..########..',
  ],
  robot: [
    '.....##.....',
    '.....##.....',
    '.##########.',
    '.#WW####WW#.',
    '.#WP####WP#.',
    '.##########.',
    '.###PPPP###.',
    '.##########.',
    '...##..##...',
    '..###..###..',
  ],
  frog: [
    '.###....###.',
    '#WWW#..#WWW#',
    '#WPP####WPP#',
    '############',
    '############',
    '##P######P##',
    '###PPPPPP###',
    '.##########.',
    '..########..',
    '.###....###.',
  ],
  mushroom: [
    '...######...',
    '.##WW###W##.',
    '####WW######',
    '#WW#####WW##',
    '############',
    '...WWWWWW...',
    '...WPWWPW...',
    '...WWWWWW...',
    '....WWWW....',
  ],
  octopus: [
    '...######...',
    '..########..',
    '.##########.',
    '.#WW####WW#.',
    '.#WP####WP#.',
    '.##########.',
    '.##########.',
    '#.#.#..#.#.#',
    '#.#.#..#.#.#',
  ],
  bunny: [
    '..##....##..',
    '..##....##..',
    '..##....##..',
    '.##########.',
    '############',
    '##WW####WW##',
    '##WP####WP##',
    '#####PP#####',
    '############',
    '.##########.',
  ],
};

/** Hue families, each as [background, body]: a pastel and a strong shade. */
const HUES = [
  ['#ece9ff', '#5b45f0'], // violet
  ['#ffe6df', '#e0522f'], // coral
  ['#daf3ee', '#0f9488'], // teal
  ['#fdf0cc', '#c98a04'], // amber
  ['#fde4f1', '#d6337f'], // pink
  ['#dfeeff', '#2563eb'], // blue
  ['#e4f6dc', '#4d9a26'], // green
  ['#efe6ff', '#9333ea'], // purple
  ['#ffe4e6', '#e11d48'], // red
  ['#e0f6fd', '#0891b2'], // cyan
];

function pathFor(rows, cell) {
  return rows.flatMap((row, y) =>
    [...row].map((c, x) => (c === cell ? `M${x} ${y}h1v1h-1z` : '')),
  ).join('');
}

/** Each sprite drawn once: its three layers and a square viewBox centring it. */
const ART = Object.fromEntries(Object.entries(SPRITES).map(([name, rows]) => {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const side = Math.max(w, h) + 6;
  const viewBox = `${(w - side) / 2} ${(h - side) / 2} ${side} ${side}`;
  return [name, { viewBox, body: pathFor(rows, '#'), white: pathFor(rows, 'W'), dark: pathFor(rows, 'P') }];
}));
const NAMES = Object.keys(ART);

/** FNV-1a: a stable, well-mixed number for a string. */
function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The avatar a handle gets: creature, body colour and background. */
export function avatarFor(handle) {
  const key = String(handle).toLowerCase();
  const art = ART[NAMES[hashOf(`shape:${key}`) % NAMES.length]];
  const bgHue = hashOf(`bg:${key}`) % HUES.length;
  // The body never takes the background's own hue, so it always stands out.
  const inkHue = (bgHue + 1 + (hashOf(`ink:${key}`) % (HUES.length - 1))) % HUES.length;
  return { art, bg: HUES[bgHue][0], ink: HUES[inkHue][1] };
}

/**
 * `size` is the circle; `artSize` (defaults to `size`) is the circle the
 * creature is drawn for, so a larger circle can keep it at a smaller one's
 * size. With no `handle` (still loading) it is an empty circle.
 */
function HandleMark({ handle, size = 36, artSize = size }) {
  const avatar = handle ? avatarFor(handle) : null;
  return (
    <span
      className={styles.mark}
      style={{
        '--mark-size': `${size}px`,
        '--mark-art': `${artSize}px`,
        ...(avatar ? { '--mark-bg': avatar.bg, '--mark-ink': avatar.ink } : {}),
      }}
      aria-hidden="true"
    >
      {avatar && (
        <svg className={styles.markArt} viewBox={avatar.art.viewBox} shapeRendering="crispEdges">
          <path d={avatar.art.body} />
          <path className={styles.markEyes} d={avatar.art.white} />
          <path className={styles.markPupils} d={avatar.art.dark} />
        </svg>
      )}
    </span>
  );
}

export default memo(HandleMark);
