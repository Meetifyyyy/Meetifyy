/**
 * The profile cover library: what the Edit cover sheet offers.
 *
 * ─── Why a profile stores the CSS, not an id ───────────────────────────────
 *
 * Choosing one of these writes its `css` to `User.cover`, the same column an
 * uploaded photo's key goes in. The profile then holds a complete, immutable
 * copy of the design — a few hundred bytes — and renders it without this file.
 *
 *   - Retiring a design never breaks anyone using it. Set `selectable: false`
 *     (hidden from the picker, still recognised as "selected" for its owners)
 *     or delete the entry outright: profiles that chose it keep their copy.
 *   - Editing a design's `css` changes it for new choices only. Ship a changed
 *     look as a new entry, so the sheet does not show an existing user's cover
 *     as unselected merely because it was tuned later.
 *   - Installed apps carry a frozen copy of the frontend. Every value here
 *     starts with a gradient function, which those builds already paint as a
 *     background, so a pattern chosen today renders on them too. An id would
 *     have rendered as an empty cover on every build older than its catalogue.
 *
 * Patterns are layered CSS gradients only — no images, SVG, canvas, filters or
 * animation — so they cost one paint and scale with the cover at any aspect.
 * Sizes are in %, except the fine repeats (grid, dots, rings), which stay crisp
 * at a fixed pitch. Each keeps its busiest detail away from the lower-left,
 * where the avatar overlaps the cover.
 */

/** @typedef {{ id: string, label: string, css: string, selectable?: boolean }} CoverDesign */

/** @type {CoverDesign[]} */
export const COVER_PATTERNS = [
  {
    id: 'orbit',
    label: 'Orbit',
    css: 'radial-gradient(circle at 86% 18%, rgba(255,255,255,0.32) 0 13%, transparent 13.4%), '
      + 'radial-gradient(circle at 86% 18%, transparent 0 21%, rgba(255,255,255,0.22) 21.3% 21.9%, transparent 22.3%), '
      + 'radial-gradient(circle at 86% 18%, transparent 0 31%, rgba(255,255,255,0.12) 31.3% 31.8%, transparent 32.2%), '
      + 'linear-gradient(135deg, #4338ca 0%, #7c3aed 100%)',
  },
  {
    id: 'dunes',
    label: 'Dunes',
    css: 'radial-gradient(90% 70% at 100% 100%, #ea580c 0 50%, transparent 50.6%), '
      + 'radial-gradient(110% 80% at 15% 120%, #f97316 0 50%, transparent 50.6%), '
      + 'radial-gradient(120% 90% at 70% 135%, #fb923c 0 50%, transparent 50.6%), '
      + 'linear-gradient(180deg, #fde68a 0%, #fdba74 100%)',
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    css: 'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px) 0 0 / 28px 28px, '
      + 'linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px) 0 0 / 28px 28px, '
      + 'radial-gradient(60% 120% at 85% 0%, rgba(56,189,248,0.45) 0%, transparent 70%), '
      + 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)',
  },
  {
    id: 'ripples',
    label: 'Ripples',
    css: 'repeating-radial-gradient(circle at 100% 50%, rgba(255,255,255,0.16) 0 2px, transparent 2px 22px), '
      + 'linear-gradient(120deg, #0f766e 0%, #14b8a6 55%, #5eead4 100%)',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    css: 'radial-gradient(38% 85% at 22% 25%, rgba(244,114,182,0.85) 0%, transparent 70%), '
      + 'radial-gradient(45% 95% at 78% 75%, rgba(129,140,248,0.85) 0%, transparent 70%), '
      + 'radial-gradient(30% 70% at 58% 8%, rgba(251,191,36,0.7) 0%, transparent 70%), '
      + 'linear-gradient(180deg, #fdf2f8 0%, #eef2ff 100%)',
  },
  {
    id: 'prism',
    label: 'Prism',
    css: 'linear-gradient(115deg, transparent 0 56%, rgba(255,255,255,0.16) 56% 68%, transparent 68%), '
      + 'linear-gradient(65deg, transparent 0 62%, rgba(15,23,42,0.16) 62% 74%, transparent 74%), '
      + 'linear-gradient(115deg, transparent 0 78%, rgba(255,255,255,0.1) 78% 86%, transparent 86%), '
      + 'linear-gradient(135deg, #1d4ed8 0%, #0ea5e9 100%)',
  },
  {
    id: 'confetti',
    label: 'Dots',
    css: 'radial-gradient(rgba(255,255,255,0.28) 1.4px, transparent 1.9px) 0 0 / 18px 18px, '
      + 'radial-gradient(70% 140% at 100% 0%, rgba(255,255,255,0.22) 0%, transparent 60%), '
      + 'linear-gradient(135deg, #be123c 0%, #f43f5e 100%)',
  },
  {
    id: 'horizon',
    label: 'Horizon',
    css: 'radial-gradient(circle at 72% 125%, #fde047 0 17%, rgba(253,224,71,0.3) 17% 23%, transparent 23.4%), '
      + 'linear-gradient(180deg, #1e1b4b 0%, #6d28d9 65%, #f472b6 100%)',
  },
];

/** @type {CoverDesign[]} */
export const COVER_GRADIENTS = [
  { id: 'iris', label: 'Iris', css: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { id: 'blush', label: 'Blush', css: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { id: 'sky', label: 'Sky', css: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { id: 'mint', label: 'Mint', css: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { id: 'sunset', label: 'Sunset', css: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
  { id: 'lilac', label: 'Lilac', css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
];

const normalize = (css) => (typeof css === 'string' ? css.replace(/\s+/g, ' ').trim().toLowerCase() : '');

/** Whether a stored cover is this design (whitespace and case aside). */
export function isSameCover(stored, design) {
  return Boolean(stored) && normalize(stored) === normalize(design.css);
}

export const selectable = (designs) => designs.filter((d) => d.selectable !== false);
