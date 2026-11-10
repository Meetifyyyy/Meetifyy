import { communityMemberCount } from '@shared/utils/community';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** "1 member", "1.2K members". */
export function memberLabel(community) {
  const n = communityMemberCount(community);
  return `${compact.format(n)} ${n === 1 ? 'member' : 'members'}`;
}

/** Newest post first; communities with no posts keep their join order. */
export function byRecentActivity(a, b) {
  const ta = a.lastPostAt ? Date.parse(a.lastPostAt) : 0;
  const tb = b.lastPostAt ? Date.parse(b.lastPostAt) : 0;
  return tb - ta;
}


const toLinear = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Every hex colour in a CSS colour or gradient, as [r, g, b] in 0-255. */
function hexStops(css) {
  const stops = [];
  for (const [, h] of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    stops.push([0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  }
  return stops;
}

/**
 * The colours of a community's tile. `ground` is its colour as stored, which
 * may be a solid or a gradient and so is only fit for `background`. `ink` is
 * white or near-black, white unless the average of its stops is very pale, for text
 * and the button. `accent` is a solid colour (that average, deepened or
 * lightened) for what is set ON an ink-filled shape - the button's label, the
 * icon's letter - which a gradient string cannot be, being no valid `color`.
 * Only hex stops can be measured; anything else gets white ink on the brand blue.
 */
export function tileColors(color) {
  const ground = typeof color === 'string' && color.trim() ? color.trim() : 'var(--color-primary)';
  const stops = hexStops(ground);
  if (!stops.length) return { ground, ink: '#ffffff', accent: '#1d3f9e', deep: '#1d3f9e' };
  const mean = [0, 1, 2].map((c) => Math.round(stops.reduce((sum, rgb) => sum + rgb[c], 0) / stops.length));
  const [r, g, b] = mean.map((v) => toLinear(v / 255));
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.7;
  const base = `rgb(${mean.join(' ')})`;
  // The button is always a white pill with this deepened colour on it, on dark
  // and light tiles alike, so Join and Request look the same everywhere.
  const deep = `color-mix(in srgb, ${base} 55%, #000)`;
  return dark
    ? { ground, ink: '#ffffff', accent: deep, deep }
    : { ground, ink: '#14141a', accent: `color-mix(in srgb, ${base} 45%, #fff)`, deep };
}
