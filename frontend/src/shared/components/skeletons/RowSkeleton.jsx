import Skeleton from './Skeleton';

// Varied a little so a column of rows reads as a list, not a barcode.
const PRIMARY_WIDTHS = ['52%', '64%', '44%', '58%', '48%', '60%', '40%', '56%'];
const SECONDARY_WIDTHS = ['34%', '42%', '28%', '38%', '46%', '30%', '36%', '40%'];

const defaultRowStyle = { display: 'flex', alignItems: 'center', gap: '12px' };
const lineStyle = { display: 'block', marginBottom: 0 };

/**
 * A list of avatar + text rows while a list of people/items loads.
 *
 * Only the major block is drawn - the avatar and one or two text lines. A
 * row's trailing button or checkbox is static chrome and is not skeletonised;
 * its space is simply left empty.
 *
 * Pass the real row's `rowClassName` (or `rowStyle`) so the placeholders use
 * the same padding, gap and height as the rows that replace them.
 *
 * @param {object} props
 * @param {number} [props.count=5]          Rows to draw.
 * @param {string} [props.avatarSize='40px']
 * @param {string} [props.avatarRadius]     Corner radius for a square tile
 *                                          (e.g. '10px'); a circle when omitted.
 * @param {1|2}    [props.lines=2]          Text lines per row.
 * @param {string} [props.rowClassName]     Class of the real row, for geometry.
 * @param {object} [props.rowStyle]         Inline geometry when there is no class.
 * @param {string} [props.label='Loading']  Accessible name of the status region.
 * @param {string} [props.className]        Class for the wrapping element.
 */
export default function RowSkeleton({
  count = 5,
  avatarSize = '40px',
  avatarRadius,
  lines = 2,
  rowClassName,
  rowStyle,
  label = 'Loading',
  className,
}) {
  const style = rowClassName ? rowStyle : { ...defaultRowStyle, ...rowStyle };
  return (
    <div role="status" aria-label={label} className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={rowClassName} style={style} aria-hidden="true">
          {avatarRadius ? (
            <Skeleton
              type="rect"
              width={avatarSize}
              height={avatarSize}
              style={{ borderRadius: avatarRadius, flexShrink: 0 }}
            />
          ) : (
            <Skeleton type="circle" width={avatarSize} height={avatarSize} />
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Skeleton
              type="text"
              width={PRIMARY_WIDTHS[i % PRIMARY_WIDTHS.length]}
              height="0.85rem"
              style={lineStyle}
            />
            {lines > 1 && (
              <Skeleton
                type="text"
                width={SECONDARY_WIDTHS[i % SECONDARY_WIDTHS.length]}
                height="0.7rem"
                style={lineStyle}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
