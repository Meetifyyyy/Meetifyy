/**
 * Campus tab icon.
 *
 * CampusOutline → Hugeicons' GraduationCapIcon, stroke (inactive tab)
 * CampusSolid   → the same cap drawn filled (active tab)
 *
 * Hugeicons' free set ships this glyph as stroke data only, and HugeiconsIcon
 * ignores `type="solid"`, so the active state used to render the outline a
 * second time. CampusSolid is drawn here from the outline's own paths, so the
 * two states share one silhouette:
 *
 *   - the board is the outline's diamond, filled and stroked at the same
 *     width, so it covers exactly what the outline covers;
 *   - the band below it is filled too, with a gap cut out under the board by a
 *     mask (the board path, stroked wider) so the two pieces stay readable as
 *     a cap at 26-28px instead of merging into one blob;
 *   - the tassel keeps its stroke and ends in a dot (the outline has it too).
 *
 * Both are passed to <NavIcon outline={…} solid={…} />, which clones a
 * className onto the element, so props are spread onto the <svg>.
 */
import { useId } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { GraduationCapIcon } from '@hugeicons/core-free-icons';

const BOARD =
  'M9.54155 4.65208L6.98306 5.92425C3.66102 7.57609 2 8.40201 2 9.75C2 11.098 3.66102 11.9239 6.98306 13.5757L9.54155 14.8479C10.751 15.4493 11.3557 15.75 12 15.75C12.6443 15.75 13.249 15.4493 14.4584 14.8479L17.0169 13.5757C20.339 11.9239 22 11.098 22 9.75C22 8.40201 20.339 7.57609 17.0169 5.92425L14.4584 4.65208C13.249 4.05069 12.6443 3.75 12 3.75C11.3557 3.75 10.751 4.05069 9.54155 4.65208Z';

// The outline's band, closed across the top so it can be filled. The top edge
// runs up under the board; the mask trims it back to an even gap.
const BAND =
  'M6 11V17.057C6 17.1486 6 17.1944 6.00176 17.2369C6.03098 17.9434 6.42116 18.5835 7.03141 18.926C7.06808 18.9466 7.10848 18.967 7.18928 19.008C7.51967 19.1755 7.68487 19.2592 7.84453 19.3332C10.4837 20.5556 13.5163 20.5556 16.1555 19.3332C16.3151 19.2592 16.4803 19.1755 16.8107 19.008C16.8915 18.967 16.9319 18.9466 16.9686 18.926C17.5788 18.5835 17.969 17.9434 17.9982 17.2369C18 17.1944 18 17.1486 18 17.057V11Z';

const STROKE = 1.5;
// Clear space between the board's edge and the band, in viewBox units.
const GAP = 1.1;

/*
 * The outline with the solid state's tassel end, so the cap does not grow a
 * ball only when the tab turns active. HugeiconsIcon strokes every child at
 * the outline width, the circle included, so its radius is the solid's minus
 * half that stroke: both ends come out the same size.
 */
const TASSEL_END = { cx: 22, cy: 16.35, r: 1.35 };
const outlineIcon = (strokeWidth) => [
  ...GraduationCapIcon.filter(([, attrs]) => attrs.d !== 'M22 9.75V16.2506'),
  ['path', { d: 'M22 9.75V15.6', stroke: 'currentColor', strokeLinecap: 'round', key: 'tassel' }],
  [
    'circle',
    {
      cx: TASSEL_END.cx,
      cy: TASSEL_END.cy,
      r: TASSEL_END.r - strokeWidth / 2,
      fill: 'currentColor',
      stroke: 'currentColor',
      key: 'tassel-end',
    },
  ],
];

export const CampusOutline = ({ size = 22, strokeWidth = 1.7, ...props }) => (
  <HugeiconsIcon
    icon={outlineIcon(strokeWidth)}
    type="stroke"
    strokeWidth={strokeWidth}
    size={size}
    {...props}
  />
);

export const CampusSolid = ({ size = 22, ...props }) => {
  const maskId = `campus-cap-gap-${useId().replace(/:/g, '')}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      {...props}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <path
            d={BOARD}
            fill="#000"
            stroke="#000"
            strokeWidth={STROKE + GAP * 2}
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <path
        d={BAND}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
        mask={`url(#${maskId})`}
      />
      <path
        d={BOARD}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M22 9.75V15.6"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <circle cx={TASSEL_END.cx} cy={TASSEL_END.cy} r={TASSEL_END.r} fill="currentColor" />
    </svg>
  );
};
