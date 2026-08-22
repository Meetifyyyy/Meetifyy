import React from 'react';

/**
 * The Instant Match decorative kit.
 *
 * Every piece is inline SVG so it inherits `currentColor` and the feature's
 * scoped palette, costs no extra request, and stays crisp at any size. All of
 * it is ornamental, so each piece is `aria-hidden` and never focusable —
 * screen readers get the copy, sighted users get the poster.
 */

const hidden = { 'aria-hidden': true, focusable: 'false' };

/** Organic blob used as a colour field behind headings and avatars. */
export function Blob({ className = '', variant = 1, style }) {
  const paths = {
    1: 'M43.6,-58.2C55.4,-49.5,62.9,-34.8,67.5,-19.2C72.1,-3.6,73.8,12.9,68.2,26.6C62.6,40.3,49.7,51.2,35.5,58.8C21.3,66.4,5.8,70.7,-9.9,69.3C-25.6,67.9,-41.5,60.8,-53.6,49.2C-65.7,37.6,-74,21.5,-75.6,4.5C-77.2,-12.5,-72.1,-30.4,-61.3,-43.2C-50.5,-56,-34,-63.7,-18.2,-67.4C-2.4,-71.1,12.7,-70.8,27.4,-67.9C42.1,-65,52.4,-59.5,43.6,-58.2Z',
    2: 'M38.9,-52.6C50.3,-44.6,59.3,-33.1,64.6,-19.6C69.9,-6.1,71.5,9.4,66.9,22.7C62.3,36,51.5,47.1,38.6,55.3C25.7,63.5,10.7,68.8,-4.6,68.4C-19.9,68,-35.5,61.9,-47.9,51.7C-60.3,41.5,-69.5,27.2,-72.4,11.6C-75.3,-4,-71.9,-20.9,-63.2,-34.2C-54.5,-47.5,-40.5,-57.2,-26.1,-64.3C-11.7,-71.4,3.1,-75.9,16.4,-72.3C29.7,-68.7,41.5,-57,38.9,-52.6Z',
    3: 'M47.4,-64.3C60.1,-55.9,68.1,-40.3,71.9,-24.3C75.7,-8.3,75.3,8.1,69.4,21.9C63.5,35.7,52.1,46.9,39.1,55.6C26.1,64.3,11.5,70.5,-3.9,75.8C-19.3,81.1,-35.5,85.5,-47.8,79.4C-60.1,73.3,-68.5,56.7,-72.6,40.1C-76.7,23.5,-76.5,6.9,-72.9,-8.4C-69.3,-23.7,-62.3,-37.7,-51.5,-46.9C-40.7,-56.1,-26.1,-60.5,-11.8,-63.9C2.5,-67.3,16.5,-69.7,30.1,-70.3C43.7,-70.9,56.9,-69.7,47.4,-64.3Z',
  };
  return (
    <svg className={`im-decor im-blob ${className}`} viewBox="-100 -100 200 200" style={style} {...hidden}>
      <path d={paths[variant] || paths[1]} fill="currentColor" />
    </svg>
  );
}

/** Sharp radiating burst — used to punctuate success and "found it" moments. */
export function Starburst({ className = '', points = 12, style }) {
  const spikes = [];
  for (let i = 0; i < points * 2; i += 1) {
    const angle = (Math.PI * i) / points;
    const radius = i % 2 === 0 ? 50 : 30;
    spikes.push(`${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`);
  }
  return (
    <svg className={`im-decor im-starburst ${className}`} viewBox="-56 -56 112 112" style={style} {...hidden}>
      <polygon points={spikes.join(' ')} fill="currentColor" />
    </svg>
  );
}

/** Hand-drawn underline for display headings. */
export function Squiggle({ className = '', style }) {
  return (
    <svg className={`im-decor im-squiggle ${className}`} viewBox="0 0 200 14" preserveAspectRatio="none" style={style} {...hidden}>
      <path
        d="M2 9C18 3 30 3 46 8s28 5 44 0 28-5 44 0 26 4 42-2"
        fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"
      />
    </svg>
  );
}

/** Riso-style halftone field, layered under colour blocks for texture. */
export function Halftone({ className = '', style, id = 'im-dots' }) {
  return (
    <svg className={`im-decor im-halftone ${className}`} style={style} {...hidden}>
      <defs>
        <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.6" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** Concentric arcs — the visual language for "scanning / searching". */
export function Arcs({ className = '', style }) {
  return (
    <svg className={`im-decor im-arcs ${className}`} viewBox="0 0 120 120" style={style} {...hidden}>
      {[20, 34, 48].map((r, i) => (
        <circle
          key={r} cx="60" cy="60" r={r}
          fill="none" stroke="currentColor"
          strokeWidth={3 - i * 0.6}
          strokeDasharray={`${r * 1.4} ${r * 4}`}
          strokeLinecap="round"
          opacity={0.9 - i * 0.22}
        />
      ))}
    </svg>
  );
}

/** The Instant Match bolt. The one mark that appears on every surface. */
export function Bolt({ className = '', style }) {
  return (
    <svg className={`im-bolt ${className}`} viewBox="0 0 24 24" style={style} {...hidden}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" />
    </svg>
  );
}

/** Loose grid of ticks, used to fill negative space in the poster panels. */
export function Ticks({ className = '', style }) {
  return (
    <svg className={`im-decor im-ticks ${className}`} viewBox="0 0 60 60" style={style} {...hidden}>
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => (
          <path
            key={`${row}-${col}`}
            d={`M${8 + col * 20} ${8 + row * 20} l6 6 M${14 + col * 20} ${8 + row * 20} l-6 6`}
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          />
        )),
      )}
    </svg>
  );
}

/** Soft paper grain, laid over the whole surface at low opacity. */
export function Grain({ className = '' }) {
  return (
    <svg className={`im-grain ${className}`} {...hidden}>
      <filter id="im-grain-filter">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#im-grain-filter)" />
    </svg>
  );
}

/**
 * Layered poster backdrop: a wash, a halftone field, a blob and a burst,
 * tinted by whatever `--im-accent` the surrounding surface has set.
 */
export function PosterBackdrop({ tone = 'a', className = '' }) {
  return (
    <div className={`im-backdrop im-backdrop-${tone} ${className}`} aria-hidden="true">
      <Halftone className="im-backdrop-dots" id={`im-dots-${tone}`} />
      <Blob className="im-backdrop-blob-1" variant={1} />
      <Blob className="im-backdrop-blob-2" variant={3} />
      <Starburst className="im-backdrop-burst" points={10} />
      <Grain />
    </div>
  );
}
