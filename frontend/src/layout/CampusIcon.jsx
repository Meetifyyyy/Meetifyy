/**
 * The Campus tab's icon, shared by the left sidebar and the bottom navigation
 * so the two cannot drift apart.
 *
 * Campus has no Heroicons counterpart, so both variants are drawn here -- the
 * same shape the nav has always used, unchanged in geometry. Only the paint
 * differs between them, and each spreads props so <NavIcon> can hand it the
 * layer class that cross-fades the pair.
 */
export const CampusOutline = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
    <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" />
  </svg>
);

/**
 * The active state is fully solid -- board and cap both filled -- so the tab
 * reads as properly "on" rather than half-drawn.
 *
 * Filled edge to edge, though, the mortarboard and the head under it merge into
 * one shape with no cap left to see. The cap keeps a thin stroke in the surface
 * colour to separate them: where that stroke runs along the outside of the
 * glyph it is invisible (painted in the same colour as what sits behind it),
 * and where it crosses the filled board it shows as the hairline that tells the
 * top of the hat from the bottom.
 *
 * --color-bg-white is the token both navigations use for their own background
 * and it flips with the theme (#FFFFFF light, #202020 dark), so the line
 * follows the theme without a second rule.
 */
export const CampusSolid = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {/* The tassel stays a stroked line -- filling it would do nothing. */}
    <path d="M22 10v6" />
    {/* Board first, cap over it: the separating line belongs to the cap, so the
        cap has to be the one drawn on top.

        The cap's top edge is a V (`M6 12 L12 15 L18 12`) tracing the board's own
        underside, so the gap runs parallel to the board's lower edges and the
        two shapes stay visibly joined. A curve there instead left the cap
        looking detached from the hat.

        0.9 is deliberately hairline: it still resolves at the 22px the sidebar
        renders at, where anything thinner closes up. */}
    <path d="M2 10l10-5 10 5-10 5z" fill="currentColor" />
    <path
      d="M6 12L12 15L18 12V17c0 2-2 3-6 3s-6-1-6-3z"
      fill="currentColor"
      stroke="var(--color-bg-white)"
      strokeWidth="0.9"
    />
  </svg>
);
