/**
 * The colours the current page paints where the phone's status bar and
 * navigation bar meet it, so the bars can continue the page instead of
 * sitting on it as separate strips.
 *
 * For each edge the topmost element under the edge's centre that actually
 * paints a background wins: an opaque background colour, or the app's radial
 * page gradient (`body`, `Background`), whose colour is computed at the point
 * the bar covers rather than read as one flat value. Text, icons and
 * transparent wrappers and anything narrower than the screen (cards) are
 * looked through.
 */

const GRADIENT_STOPS = [
  ['--bg-gradient-center', 0],
  ['--bg-gradient-mid', 0.45],
  ['--bg-gradient-edge', 1],
];

function parseColor(value) {
  if (!value) return null;
  const v = value.trim();
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/i);
  if (rgb) {
    let a = rgb[4] == null ? 1 : parseFloat(rgb[4]);
    if (rgb[4] && rgb[4].endsWith('%')) a /= 100;
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a };
  }
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  return null;
}

const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;

const mix = (c1, c2, t) => ({
  r: c1.r + (c2.r - c1.r) * t,
  g: c1.g + (c2.g - c1.g) * t,
  b: c1.b + (c2.b - c1.b) * t,
  a: 1,
});

/**
 * The page gradient's colour at viewport point (x, y). The gradient is
 * `circle at center` sized to the farthest corner of the viewport, so the
 * position along it is the distance from the centre over the half-diagonal.
 * `y` may lie outside the viewport: the bars sit just beyond its edges.
 */
export function pageGradientColorAt(x, y, width, height, readVar) {
  const stops = GRADIENT_STOPS.map(([name, at]) => [parseColor(readVar(name)), at]);
  if (stops.some(([c]) => !c)) return null;
  const radius = Math.hypot(width / 2, height / 2) || 1;
  const t = Math.min(1, Math.hypot(x - width / 2, y - height / 2) / radius);
  for (let i = 1; i < stops.length; i += 1) {
    const [c0, p0] = stops[i - 1];
    const [c1, p1] = stops[i];
    if (t <= p1) return mix(c0, c1, (t - p0) / (p1 - p0 || 1));
  }
  return stops[stops.length - 1][0];
}

function isPageGradient(style) {
  return /radial-gradient/.test(style.backgroundImage);
}

/** The colour painted at viewport point (x, probeY), or null if undecidable. */
function paintedColorAt(x, probeY, barY) {
  const root = document.documentElement;
  const readVar = (name) => getComputedStyle(root).getPropertyValue(name);
  const stack = document.elementsFromPoint(x, probeY);
  const width = window.innerWidth;
  const height = window.innerHeight;

  for (const el of [...stack, document.body]) {
    const style = getComputedStyle(el);
    if (isPageGradient(style) && (el === document.body || style.position === 'fixed')) {
      return pageGradientColorAt(x, barY, width, height, readVar);
    }
    // Only a surface as wide as the screen can be what the bar continues;
    // a card that happens to sit at the edge is content, not the page.
    if (el.getBoundingClientRect().width < width - 1) continue;
    const c = parseColor(style.backgroundColor);
    if (c && c.a >= 0.95) return c;
  }
  return null;
}

/**
 * `{ top, bottom }` as `#rrggbb`, or null for an edge that could not be read.
 * The top is probed 1px inside the page and the colour evaluated at the top
 * edge; likewise for the bottom.
 */
export function readPageEdgeColors() {
  if (typeof document === 'undefined' || !document.elementsFromPoint) return { top: null, bottom: null };
  const x = window.innerWidth / 2;
  const h = window.innerHeight;
  const root = document.getElementById('root');
  // Ordinary Android pages start below the opaque status bar: global.css
  // applies the native inset as padding on #root. Sampling y=1 reads the
  // window canvas above that page and returns the theme fallback instead of
  // the page's actual surface. Full-bleed entry/auth screens have no root
  // padding, so their top edge correctly remains y=0.
  const contentTop = root ? Number.parseFloat(getComputedStyle(root).paddingTop) || 0 : 0;
  const topProbe = Math.min(Math.max(0, contentTop + 1), Math.max(0, h - 1));
  // Evaluated AT the seam, not at the middle of each bar: a flat bar is judged
  // against the pixels it touches, and the gradient's value half a bar further
  // out read as a visibly different shade.
  const top = paintedColorAt(x, topProbe, contentTop);
  const bottom = paintedColorAt(x, h - 1, h);
  return { top: top && toHex(top), bottom: bottom && toHex(bottom) };
}
