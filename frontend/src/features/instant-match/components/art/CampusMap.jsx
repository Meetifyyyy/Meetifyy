import { memo, useEffect, useRef } from 'react';
import { activityGlyph, areaGlyph } from './icons';
import '../../styles/art.css';

/**
 * The Instant Match artwork: a small campus, drawn in code.
 *
 * One idea carries the whole feature — routes across campus that end at the
 * same spot. The campus is a 2.5D street grid: every building has a roof, a
 * wall and a shadow, the named places a student can pick (library, cafeteria,
 * academic block, hostel, sports complex, main gate) are real landmarks on it,
 * and the scenes reuse that one map:
 *
 *   SearchScene   people walking the streets towards you
 *   PlanScene     your pin, carrying your activity, standing at your area
 *   RosterScene   everyone searching right now, pinned where they said
 *   MeetScene     two routes that met (match), faded (ended), or one route
 *                 to an open spot (empty)
 *
 * Every colour is a scoped token (styles/art.css), so it follows the app's
 * light and dark themes. All of it is decorative; the copy beside it carries
 * the meaning. Motion is transform and opacity only, apart from the one-shot
 * route draw on a match.
 */

export const MAP_W = 320;
export const MAP_H = 200;
export const MEET = { x: 160, y: 100 };

/** Road centre lines. Lots sit between them, 7 units clear of each side. */
const ROADS_X = [-40, 60, 160, 260, 360];
const ROADS_Y = [-92, -28, 36, 100, 164, 228, 292];
const D = 5; // building height, in map units

const lot = (i, j) => ({
  x: ROADS_X[i] + 7,
  y: ROADS_Y[j] + 7,
  w: ROADS_X[i + 1] - ROADS_X[i] - 14,
  h: ROADS_Y[j + 1] - ROADS_Y[j] - 14,
});

/** Where each campus area stands, and the spot a pin for it points at. */
const LANDMARKS = {
  library:        { ...lot(1, 2), tone: 'blue' },
  academic_block: { ...lot(2, 2), tone: 'violet' },
  cafeteria:      { x: 67, y: 107, w: 48, h: 50, tone: 'amber' },
  hostel:         { x: 5, y: 107, w: 48, h: 50, tone: 'rose' },
};

export const AREA_SPOTS = {
  library:        { x: 110, y: 66 },
  academic_block: { x: 210, y: 66 },
  cafeteria:      { x: 91, y: 130 },
  hostel:         { x: 29, y: 130 },
  sports_complex: { x: 210, y: 132 },
  main_gate:      { x: 260, y: 132 },
  other:          { x: 160, y: 100 },
  '':             { x: 160, y: 100 },
};

export function spotFor(area) {
  return AREA_SPOTS[area ?? ''] || AREA_SPOTS[''];
}

/** Ordinary buildings, as [x, y, w, h]. Some lots are split in two. */
const BUILDINGS = (() => {
  const out = [];
  const taken = new Set(['1,2', '2,2', '0,3', '1,3', '2,3', '3,2']);
  const splitV = new Set(['1,1', '0,4', '2,4', '3,0', '0,1']);
  const splitH = new Set(['3,3', '2,1', '1,5']);
  for (let j = 0; j < ROADS_Y.length - 1; j += 1) {
    for (let i = 0; i < ROADS_X.length - 1; i += 1) {
      const key = `${i},${j}`;
      if (taken.has(key)) continue;
      const { x, y, w, h } = lot(i, j);
      if (splitV.has(key)) {
        out.push([x, y, 40, h], [x + 46, y, w - 46, h]);
      } else if (splitH.has(key)) {
        out.push([x, y, w, 22], [x, y + 28, w, h - 28]);
      } else {
        out.push([x, y, w, h]);
      }
    }
  }
  // The rest of the hostel lot and the cafeteria lot.
  out.push([-33, 107, 32, 50], [121, 107, 32, 50]);
  return out;
})();

const FIELD = lot(2, 3);
const PARK = lot(3, 2);
const TREES = [[282, 58, 7], [300, 76, 6], [322, 56, 8], [338, 80, 6], [288, 84, 5]];

function Building({ x, y, w, h, tone = '', lit = false }) {
  const cls = lit ? 'is-lit' : tone ? `is-${tone}` : '';
  return (
    <g className={`im-bld ${cls}`}>
      <rect className="im-bld-shadow" x={x + 2.5} y={y + 2.5} width={w} height={h} rx="5" />
      <rect className="im-bld-wall" x={x} y={y} width={w} height={h} rx="5" />
      <rect className="im-bld-roof" x={x} y={y - D} width={w} height={h} rx="5" />
    </g>
  );
}

/** A landmark: a building with its area's mark on the roof. */
function Landmark({ id, lit }) {
  const b = LANDMARKS[id];
  const cx = b.x + b.w / 2;
  const cy = b.y - D + b.h / 2;
  return (
    <g className={`im-landmark is-${b.tone} ${lit ? 'is-lit' : ''}`}>
      <Building {...b} lit={lit} />
      <g
        className="im-landmark-mark"
        transform={`translate(${cx - 7.2} ${cy - 7.2}) scale(0.6)`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {areaGlyph(id)}
      </g>
    </g>
  );
}

function World({ highlight = null }) {
  return (
    <g className="im-map-world">
      <rect className="im-map-road" x="-60" y="-120" width="440" height="440" />
      <g className="im-map-lane">
        <path d={[
          ...ROADS_X.map((x) => `M${x} -120V320`),
          ...ROADS_Y.map((y) => `M-60 ${y}H380`),
        ].join('')} />
      </g>

      {BUILDINGS.map(([x, y, w, h]) => (
        <Building key={`${x},${y}`} x={x} y={y} w={w} h={h} />
      ))}

      {/* Park, with trees. */}
      <rect className="im-map-park" x={PARK.x} y={PARK.y} width={PARK.w} height={PARK.h} rx="6" />
      {TREES.map(([cx, cy, r]) => (
        <g key={`${cx},${cy}`}>
          <circle className="im-map-tree-shadow" cx={cx + 1.5} cy={cy + 2} r={r} />
          <circle className="im-map-tree" cx={cx} cy={cy} r={r} />
        </g>
      ))}

      {/* Sports complex: a field with a running track. */}
      <g className={`im-field ${highlight === 'sports_complex' ? 'is-lit' : ''}`}>
        <rect className="im-field-grass" x={FIELD.x} y={FIELD.y} width={FIELD.w} height={FIELD.h} rx="6" />
        <rect className="im-field-line" x={FIELD.x + 7} y={FIELD.y + 7} width={FIELD.w - 14} height={FIELD.h - 14} rx="18" />
        <path className="im-field-line" d={`M${FIELD.x + FIELD.w / 2} ${FIELD.y + 7}V${FIELD.y + FIELD.h - 7}`} />
      </g>

      {Object.keys(LANDMARKS).map((id) => (
        <Landmark key={id} id={id} lit={highlight === id} />
      ))}

      {/* Main gate: an arch over the road between the field and the next block. */}
      <g className={`im-gate ${highlight === 'main_gate' ? 'is-lit' : ''}`}>
        <rect className="im-bld-shadow" x="252.5" y="126.5" width="5" height="10" rx="1.5" />
        <rect className="im-bld-shadow" x="264.5" y="126.5" width="5" height="10" rx="1.5" />
        <rect className="im-gate-post" x="250" y="118" width="5" height="16" rx="1.5" />
        <rect className="im-gate-post" x="265" y="118" width="5" height="16" rx="1.5" />
        <path className="im-gate-arch" d="M252.5 119.5Q260 111 267.5 119.5" />
      </g>
    </g>
  );
}

function Svg({ className = '', viewBox = `0 0 ${MAP_W} ${MAP_H}`, children }) {
  return (
    <svg
      className={`im-map ${className}`}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Routes into the meeting point, along the roads. Mirrored by art.css. */
const ROUTES = {
  west: 'M-10 36H160V100',
  east: 'M330 164H160V100',
  north: 'M260 -10V100H160',
  south: 'M60 210V100H160',
};

/** A map pin whose tip is at (0, 0). */
function Pin({ activity, className = '', ink }) {
  const style = ink ? { '--im-pin-l': ink.light, '--im-pin-d': ink.dark } : undefined;
  return (
    <g className={`im-pin ${className}`} style={style}>
      <ellipse className="im-pin-shadow" cx="0" cy="0" rx="6" ry="2.2" />
      <path
        className="im-pin-body"
        d="M0 0C-2.6-4.6-11-9.6-11-18.5a11 11 0 1 1 22 0C11-9.6 2.6-4.6 0 0Z"
      />
      {activity ? (
        <g
          className="im-pin-glyph"
          transform="translate(-7.2 -25.7) scale(0.6)"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {activityGlyph(activity)}
        </g>
      ) : (
        <circle className="im-pin-dot" cx="0" cy="-18.5" r="3.6" />
      )}
    </g>
  );
}

/**
 * Searching: people's routes converging on you.
 *
 * Four walkers follow the roads towards the centre on a staggered loop, so
 * one is always on the way and the loop never visibly restarts. Renders once;
 * the browser owns every frame after that, and it pauses while the tab is
 * hidden.
 */
export const SearchScene = memo(function SearchScene({ className = '', activity }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const sync = () => { el.dataset.paused = document.hidden ? 'true' : 'false'; };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  return (
    <div className={`im-scene im-scene-search ${className}`} ref={ref} aria-hidden="true">
      <Svg>
        <World />
        {Object.entries(ROUTES).map(([key, d]) => (
          <path key={key} d={d} className="im-map-trail" />
        ))}
        {Object.keys(ROUTES).map((key) => (
          <g key={key} className={`im-map-walker im-map-walker-${key}`}>
            <ellipse className="im-pin-shadow" cx="1" cy="3" rx="5" ry="2" />
            <circle r="5.2" />
          </g>
        ))}
        <circle cx={MEET.x} cy={MEET.y} r="10" className="im-map-signal im-map-signal-1" />
        <circle cx={MEET.x} cy={MEET.y} r="10" className="im-map-signal im-map-signal-2" />
        <g transform={`translate(${MEET.x} ${MEET.y})`}>
          <Pin activity={activity} className="im-pin-you" />
        </g>
      </Svg>
    </div>
  );
});

/**
 * The plan so far, on the question steps: one pin, carrying the activity the
 * user picked, standing at the area they chose (the centre until they choose).
 * The pin glides between areas and that area's building lights up; "later
 * today" warms the light. The band persists across steps, so the picture
 * builds up as the questions are answered.
 */
export function PlanScene({ activity, area, time, className = '' }) {
  const spot = spotFor(area);
  return (
    <div className={`im-scene im-scene-plan ${className}`} data-time={time || undefined} aria-hidden="true">
      <Svg viewBox="0 30 320 128">
        <World highlight={area || null} />
        <g className="im-pin-move" style={{ transform: `translate(${spot.x}px, ${spot.y}px)` }}>
          <g key={activity || 'none'} className="im-pin-pop">
            <Pin activity={activity} className="im-pin-you" />
          </g>
        </g>
      </Svg>
    </div>
  );
}

/**
 * Everyone searching right now, pinned at the area they gave — or along the
 * central roads when they gave none, which claims nothing about where they
 * are. Pins at the same place fan out so none hides another.
 */
export function RosterScene({ people = [], className = '' }) {
  const placed = [];
  const used = new Map();
  people.slice(0, 8).forEach((p, i) => {
    const base = p.area && AREA_SPOTS[p.area]
      ? AREA_SPOTS[p.area]
      : FREE_SPOTS[i % FREE_SPOTS.length];
    // Keyed by where the pin lands, not why: an area and a free spot can be
    // the same point (the centre), and two pins there must still fan out.
    const key = `${base.x},${base.y}`;
    const n = used.get(key) || 0;
    used.set(key, n + 1);
    placed.push({
      id: p.user?.id ?? i,
      activity: p.activity,
      ink: p.ink,
      x: base.x + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 16,
      y: base.y,
      delay: i * 90,
    });
  });
  placed.sort((a, b) => a.y - b.y);

  return (
    <div className={`im-scene im-scene-roster ${className}`} aria-hidden="true">
      <Svg viewBox="0 30 320 128">
        <World />
        {placed.map((p) => (
          <g key={p.id} transform={`translate(${p.x} ${p.y})`}>
            <g className="im-pin-drop" style={{ animationDelay: `${p.delay}ms` }}>
              <Pin activity={p.activity} ink={p.ink} />
            </g>
          </g>
        ))}
      </Svg>
    </div>
  );
}

/** Road positions for people who gave no area. */
const FREE_SPOTS = [
  { x: 160, y: 100 }, { x: 60, y: 100 }, { x: 160, y: 60 }, { x: 260, y: 100 },
  { x: 120, y: 100 }, { x: 200, y: 100 },
];

/**
 * Two routes that met. `variant`:
 *   match    the campus, clean, with the avatar(s) at its centre
 *   ended    the same routes, faded and broken — the walk is over
 *   empty    every road leading to your pin, with nobody on them yet
 *
 * `children` are laid over the meeting point; the map is centred and sliced,
 * so the meeting point is the centre of the box whatever its shape.
 */
export function MeetScene({ variant = 'match', className = '', children }) {
  return (
    <div className={`im-scene im-scene-${variant} ${className}`}>
      <Svg>
        <World />
        {variant === 'empty' ? (
          <>
            {Object.entries(ROUTES).map(([key, d]) => (
              <path key={key} d={d} className="im-map-trail" />
            ))}
            <circle cx={MEET.x} cy={MEET.y} r="10" className="im-map-signal im-map-signal-1" />
            <circle cx={MEET.x} cy={MEET.y} r="10" className="im-map-signal im-map-signal-2" />
            <circle cx={MEET.x} cy={MEET.y} r="17" className="im-map-open" />
            <g transform={`translate(${MEET.x} ${MEET.y + 6})`}>
              <Pin className="im-pin-you" />
            </g>
          </>
        ) : (
          <>
            {/* A match keeps the map clean behind the faces; only an ended
                one draws its routes, faded, to say the walk is over. */}
            {variant === 'ended' && (
              <>
                <path d={ROUTES.south} className="im-map-route im-map-route-a" pathLength="1" />
                <path d={ROUTES.north} className="im-map-route im-map-route-b" pathLength="1" />
                <circle cx={MEET.x} cy={MEET.y} r="9" className="im-map-open" />
              </>
            )}
          </>
        )}
      </Svg>
      {children && <div className="im-scene-center">{children}</div>}
    </div>
  );
}
