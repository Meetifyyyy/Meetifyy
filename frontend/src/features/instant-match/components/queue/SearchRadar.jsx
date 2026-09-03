import { memo, useEffect, useRef } from 'react';
import { Bolt } from '../decor/Decor';

/**
 * The searching field — a campus sonar.
 *
 * Reads as active discovery rather than as a spinner. Three things happen at
 * once and none of them restarts from a start frame, so a long wait never looks
 * stuck:
 *
 *   1. A signal goes out — three pulse rings expand from the centre on a
 *      staggered loop, so one is always mid-flight.
 *   2. A beam sweeps the field once every SWEEP_SECONDS.
 *   3. The beam finds people — each candidate sits at a fixed bearing and
 *      lights up, with a line drawn back to the centre, at the moment the beam
 *      crosses it.
 *
 * That third part is the whole point, and it is why the numbers below are not
 * arbitrary. A candidate at bearing θ is crossed at (θ/360) × SWEEP_SECONDS
 * into each revolution, so its blip runs on the sweep's own period with a
 * negative delay that lands the flash exactly there. The effect is causal: the
 * beam appears to discover each person as it reaches them, which is the thing
 * the screen is claiming to do. Change the period and the delays have to be
 * recomputed with it — hence the derivation in code rather than five magic
 * numbers in the stylesheet.
 *
 * Every animation is transform or opacity only. Nothing here animates
 * box-shadow, filter or a layout property, so the whole field composites on the
 * GPU and a mid-range phone is not repainting it sixty times a second. There is
 * no JavaScript animation loop and no React state: this component renders once
 * and the browser owns every frame after that.
 *
 * Purely decorative — `aria-hidden`, with the real status announced as text
 * beside it in SearchingScreen.
 */

/** One full revolution of the beam. Keep in sync with `--im-sweep` in CSS. */
const SWEEP_SECONDS = 4;

/**
 * Where the beam finds people, as bearings in degrees clockwise from twelve
 * o'clock, each with a radius. Deliberately uneven: evenly spaced dots read as
 * a decorative pattern, uneven ones read as a real scatter of people.
 */
const CANDIDATES = [
  { bearing: 34,  radius: 72, size: 4.6, tone: 'accent' },
  { bearing: 92,  radius: 52, size: 3.8, tone: 'coral'  },
  { bearing: 155, radius: 80, size: 4.2, tone: 'accent' },
  { bearing: 221, radius: 44, size: 3.4, tone: 'sun'    },
  { bearing: 300, radius: 66, size: 4.0, tone: 'coral'  },
];

const CENTRE = 100;
const CORE_RADIUS = 22;

/** Polar bearing (clockwise from top) to the SVG's cartesian space. */
function place(bearing, radius) {
  const rad = (bearing * Math.PI) / 180;
  return {
    x: CENTRE + radius * Math.sin(rad),
    y: CENTRE - radius * Math.cos(rad),
  };
}

const PLOTTED = CANDIDATES.map((c) => {
  const { x, y } = place(c.bearing, c.radius);
  // The line stops short of the core so it reads as reaching *towards* the
  // centre rather than piercing it.
  const start = place(c.bearing, CORE_RADIUS);
  return {
    ...c,
    x, y,
    x1: start.x,
    y1: start.y,
    // Negative delay lands the flash on the frame the beam crosses this bearing.
    delay: `${-(SWEEP_SECONDS - (c.bearing / 360) * SWEEP_SECONDS).toFixed(3)}s`,
  };
});

function SearchRadar() {
  const rootRef = useRef(null);

  /**
   * Stop animating while the tab is hidden.
   *
   * Minimising the sheet already unmounts this entirely — the search continues
   * on the server, not here — so the only case left is a backgrounded tab.
   * Browsers throttle compositing there, but throttled is not stopped, and a
   * search can run for minutes on a phone in someone's pocket.
   *
   * The attribute is written straight to the DOM rather than held in state: a
   * re-render to pause an animation would be the exact cost this component
   * exists to avoid, and CSS is what actually needs to know.
   */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const sync = () => { el.dataset.paused = document.hidden ? 'true' : 'false'; };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  return (
    <div className="im-radar" ref={rootRef} aria-hidden="true">
      {/* Soft ground the beam travels over. Static — it is the backdrop. */}
      <span className="im-radar-field" />

      {/* Signal going out. Scale + opacity only. */}
      <span className="im-radar-pulse im-radar-pulse-1" />
      <span className="im-radar-pulse im-radar-pulse-2" />
      <span className="im-radar-pulse im-radar-pulse-3" />

      {/* The beam. One steady rotation, the clock everything else reads from. */}
      <span className="im-radar-sweep" />

      <svg className="im-radar-plot" viewBox="0 0 200 200" focusable="false">
        {/* Range rings. Static: motion here competed with the sweep and made
            the field feel busy rather than calm. */}
        <g className="im-radar-grid">
          <circle cx={CENTRE} cy={CENTRE} r="88" />
          <circle cx={CENTRE} cy={CENTRE} r="62" />
          <circle cx={CENTRE} cy={CENTRE} r="36" />
        </g>

        {PLOTTED.map((c) => (
          <g
            key={c.bearing}
            className={`im-radar-find im-radar-find-${c.tone}`}
            style={{ animationDelay: c.delay }}
          >
            <line className="im-radar-link" x1={c.x1} y1={c.y1} x2={c.x} y2={c.y} />
            <circle className="im-radar-halo" cx={c.x} cy={c.y} r={c.size * 2.4} />
            <circle className="im-radar-blip" cx={c.x} cy={c.y} r={c.size} />
          </g>
        ))}
      </svg>

      {/* The centre is you. Steady, so the eye has somewhere to rest. */}
      <span className="im-radar-core">
        <span className="im-radar-core-ping" />
        <Bolt className="im-radar-bolt" />
      </span>
    </div>
  );
}

/**
 * Takes no props and holds no state, so this renders exactly once for the life
 * of a search. Without it the whole SVG reconciled on every tick of the
 * surrounding screen's timers — sixty times over a one-minute wait, for a
 * picture that had not changed.
 */
export default memo(SearchRadar);
