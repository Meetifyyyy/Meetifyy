import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useAnimate,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'framer-motion';
import Avatar from '../../components/avatar/Avatar';
import CalendarIcon from '../../components/ui/CalendarIcon';
import { DEFAULT_ACTIVITY_COVERS, getDefaultActivityCover } from '../../utils/activityCover';
import logo from '@assets/images/meetify_logo.webp';
import {
  islandDismiss,
  islandDismissNow,
  islandFinish,
  islandHold,
  islandMarkShown,
  islandPause,
  islandRelease,
  islandResume,
  islandSnapshot,
  islandSubscribe,
} from './islandStore';
import styles from './NotificationIsland.module.css';

/*
 * The single host for instant notifications. One shell moves through:
 * hidden -> pill -> expanded (one row per notification, up to three) -> pill
 * -> hidden, and is never unmounted while it has work, so every change is one
 * continuous shape. The store decides which rows exist (and queues the rest);
 * this file only animates between those states.
 *
 * Smoothness rules this file follows (each fixes something seen on device):
 * - Every island property is a motion value, and a reset is a synchronous
 *   jump(). Resets used to be zero-length animations, which had not landed
 *   when the real animation started in the same tick, so it started from the
 *   stale value: after a swipe the next notification opened already expanded
 *   (no pill, content already visible) because that is where the last one
 *   had been left.
 * - Phases overlap. The pill starts expanding while it is still popping in,
 *   and starts leaving while it is still shrinking.
 * - The content grows with the shape: it scales and fades in on the same
 *   spring as the clip, from the same moment, so the island is never an
 *   empty box waiting for its content.
 * - Rows restack as one block. A new row enters from a full row above the top
 *   edge and moves on the same spring as the rows it pushes down, so there is
 *   never a band between them; the clip grows on that spring too. A leaving
 *   row fades where it is, underneath (z-index 0), and the rows taking its
 *   slot slide over it while the clip's bottom edge follows the last row.
 * - A swipe moves only what is under the finger: the whole island when it
 *   shows one notification, otherwise just that row. A swiped row lifts out:
 *   the shell's clip opens sideways only (so the row can leave the island
 *   without being cut at its edge), the island's own shape stays on the
 *   backdrop and frame, and the other rows stay inside it untouched. Only
 *   the lifted row rounds its corners - one element's border-radius.
 * - While the rows are handled (a finger down, a row lifted, the island being
 *   flung) the store holds the visible set: nothing new is promoted under the
 *   finger. Waiting notifications enter as soon as the hold lifts.
 * - A released swipe keeps the finger's speed: a spring seeded with the drag
 *   velocity, both for flinging away and for settling back.
 * - Only transform, opacity and the shell's clip animate. The shell never
 *   changes size; it is laid out once at its largest.
 */

const PILL_W = 120;
const PILL_H = 36;
const ROW_H = 64;
const MAX_W = 380;
const RADIUS = 24;
const MAX_ROWS = 3;
const SHELL_H = ROW_H * MAX_ROWS;

// Rows restacking: critically damped (2 * sqrt(560) ~ 47), no overshoot, so
// the clip's edge and the rows can never part.
const SPRING = { type: 'spring', stiffness: 560, damping: 48, mass: 1, restDelta: 0.5 };
// Opening is two beats. First the pill arrives - the Meetifyy mark and the
// blue dot settling into place - then, once it has, it stretches into the
// card. Both are soft springs with a little give (damping ratio ~0.8), so
// the island reads as one elastic object rather than a box resizing.
const POP = { type: 'spring', stiffness: 240, damping: 24, mass: 1, restDelta: 0.001 };
// restDelta is in the animated value's own units: these drive 0..1
// progress and scale, where a pixel-sized 0.5 let the spring call itself
// done far from its target and snap the rest of the way.
const MORPH = { type: 'spring', stiffness: 230, damping: 25, mass: 1, restDelta: 0.0005, restSpeed: 0.005 };
// Gathering back into the pill: critically damped, so the card never
// shrinks past the pill and rebounds.
const GATHER = { type: 'spring', stiffness: 220, damping: 30, mass: 1, restDelta: 0.0005, restSpeed: 0.005 };
const EASE_IN_OUT = [0.45, 0, 0.55, 1];
// When the expansion starts: the pill has settled and is seen for a beat.
const PILL_BEAT = 0.55;
const EASE_OUT = [0.22, 1, 0.36, 1];
const EASE_IN = [0.4, 0, 1, 1];
const REDUCED = { duration: 0.18, ease: EASE_OUT };

// How far ahead of the shape the content is, in scale, as it grows with it.
const CONTENT_FROM = 0.94;

// The logo is a LOGO_BOX square (the artwork has generous padding, so the
// mark itself is about half of it). In the pill it sits at the left, with a
// blue dot at the right; expanded, it sits exactly where the top row's avatar
// is (row padding 12, avatar 40 in a 64 row), so it can dissolve into it.
const LOGO_BOX = 40;
const logoPill = (w) => ({ x: (w - PILL_W) / 2 - 2, y: (PILL_H - LOGO_BOX) / 2, scale: 1 });
const LOGO_AVATAR = { x: 12, y: (ROW_H - LOGO_BOX) / 2 };
// As the pill stretches into the card the mark shrinks steadily towards
// this and fades out over the first part of the stretch (the dot sooner);
// gathering back into the pill runs the same curve in reverse.
const LOGO_MIN_SCALE = 0.3;
const LOGO_FADE_BY = 0.6; // openness at which the mark is gone
const DOT_FADE_BY = 0.3;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

const SWIPE_DISTANCE = 72;
const SWIPE_VELOCITY = 500;

function expandedWidth() {
  if (typeof window === 'undefined') return MAX_W;
  return Math.min(MAX_W, window.innerWidth - 24);
}

/** The visible shape: a centred w x h rounded rect inside the fixed shell. */
function clipFor(w, h, r) {
  const side = Math.max(0, (expandedWidth() - w) / 2);
  return `inset(0px ${side}px ${SHELL_H - h}px ${side}px round ${r}px)`;
}
/**
 * The shape from its two drivers: `open` (0 = pill, 1 = card; the morph
 * spring may carry it a little past 1) and the card's height.
 */
function shapeClip(open, cardH, fullW) {
  // The spring's give shows only sideways (where the shell's own edge bounds
  // it): an overshoot in height would open space below the last row.
  const o = Math.min(1, Math.max(0, open));
  const w = PILL_W + (fullW - PILL_W) * Math.max(0, open);
  const h = PILL_H + (cardH - PILL_H) * o;
  const r = PILL_H / 2 + (RADIUS - PILL_H / 2) * o;
  return clipFor(w, h, r);
}
// The border frame is the shell's size plus 1px all round, placed at -1px;
// the same inset numbers then describe a rect 1px larger, one radius up.
const frameClip = (clip) => clip.replace(/round ([-\d.e]+)px/, (_m, r) => `round ${Number(r) + 1}px`);
// While a row is lifted the shell keeps the shape's top and bottom but opens
// sideways, so the row can leave without being cut; the shape itself stays
// on the backdrop and frame.
const INSET_RE = /inset\(\s*(\S+)\s+\S+\s+(\S+)\s+\S+\s+round[^)]*\)/;
const liftClip = (clip) => clip.replace(INSET_RE, (_m, top, bottom) => `inset(${top} -2000px ${bottom} -2000px)`);

function Leading({ content, size }) {
  if (content.variant === 'activity') {
    return (
      <span className={styles.coverWrap} style={{ width: size, height: size }}>
        <img
          src={content.avatar || getDefaultActivityCover(content.title || '')}
          alt=""
          className={styles.cover}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = DEFAULT_ACTIVITY_COVERS[0];
          }}
        />
        {content.activityDate ? (
          <span className={styles.calendarBadge}>
            <CalendarIcon date={content.activityDate} size="badge" style={{ boxShadow: 'none' }} />
          </span>
        ) : null}
      </span>
    );
  }
  return <Avatar src={content.avatar} name={content.title} size={`${size}px`} isGroup={Boolean(content.isGroup)} />;
}

const Row = memo(function Row({
  item, index, last, enterFrom, spring, wasDragged, swipeable, onSwipeStart, onSwipeEnd, onFlingDone, onSettled, track,
}) {
  const { content } = item;
  const [rowRef, animateRow] = useAnimate();
  // Owned, so "back in place" means the value is actually back at 0.
  const x = useMotionValue(0);
  const rowDraggedRef = useRef(false);
  const [lifted, setLifted] = useState(false);
  // A row on its way out keeps rendering until its exit ends; it must not
  // take a tap or a drag meant for the row sliding into its place.
  const isPresent = useIsPresent();
  // Where it first appears is fixed at mount (enterFrom, in rows): inside an
  // island that is already open, it and any rows arriving with it come down
  // as one block from above the top edge (hidden by the clip, so fully
  // opaque - nothing fades through to an empty island); in one that is only
  // now opening it is simply there, revealed by the shape growing round it.
  const [initial] = useState(() => ({ opacity: 1, y: enterFrom * ROW_H }));
  // The island reads where its rows really are (not where they are headed),
  // so its edge can never run ahead of them.
  const y = useMotionValue(initial.y);
  const { key } = item;
  useEffect(() => track(key, y, isPresent), [track, key, y, isPresent]);
  // Moved on the main thread, like the island's edge, so both are written
  // in the same frame. Through the `animate` prop, framer hands a row's
  // transform to the browser (WAAPI), which starts it frames later: the
  // card grew and the rows followed behind it.
  const targetY = index * ROW_H;
  useEffect(() => {
    if (!isPresent) return undefined;
    const controls = animate(y, targetY, spring);
    return () => controls.stop();
  }, [y, targetY, spring, isPresent]);

  const handleDragEnd = useCallback((_e, info) => {
    const { x: dx } = info.offset;
    const { x: vx } = info.velocity;
    const flung = Math.abs(dx) > SWIPE_DISTANCE || Math.abs(vx) > SWIPE_VELOCITY;
    onSwipeEnd(item.key, flung);
    if (flung) {
      const dir = (Math.abs(vx) > SWIPE_VELOCITY ? vx : dx) > 0 ? 1 : -1;
      animateRow(rowRef.current, { x: dir * (window.innerWidth * 0.6 + expandedWidth()) }, {
        type: 'spring', stiffness: 220, damping: 32, velocity: vx, restDelta: 2,
      });
      animateRow(rowRef.current, { opacity: 0 }, { duration: 0.2, delay: 0.04, ease: EASE_IN })
        .then(() => onFlingDone(item.key));
    } else {
      animate(x, 0, { type: 'spring', stiffness: 500, damping: 40, velocity: vx, restDelta: 0.1, restSpeed: 2 })
        .then(() => {
          setLifted(false);
          onSettled(item.key);
        });
    }
  }, [animateRow, rowRef, x, item.key, onSwipeEnd, onFlingDone, onSettled]);

  const open = useCallback(() => {
    if (rowDraggedRef.current) {
      rowDraggedRef.current = false;
      return;
    }
    if (wasDragged()) return;
    item.onOpen?.();
    islandDismiss(item.key);
  }, [item, wasDragged]);

  let cls = styles.row;
  if (index > 0) cls += ` ${styles.rowDivided}`;
  if (index === 0) cls += ` ${styles.rowFirst}`;
  if (last) cls += ` ${styles.rowLast}`;
  if (lifted) cls += ` ${styles.rowLifted}`;

  return (
    <motion.div
      ref={rowRef}
      // Placed explicitly at index * ROW_H; no layout projection, which
      // snapped the rows below a new arrival and blanked them for a frame.
      className={cls}
      style={{ x, y, zIndex: 1, pointerEvents: isPresent ? undefined : 'none' }}
      initial={{ opacity: initial.opacity }}
      animate={{ opacity: 1 }}
      // Fade in place, beneath the rows that slide over its slot.
      exit={{
        opacity: 0,
        zIndex: 0,
        // Lasts as long as the restack and stays visible until late in it,
        // so the rows sliding over its slot cover it before it is gone.
        transition: { opacity: { duration: 0.34, ease: EASE_IN }, zIndex: { duration: 0 } },
      }}
      transition={{ opacity: { duration: 0.2, ease: EASE_OUT } }}
      role="button"
      tabIndex={0}
      aria-label={`${content.title}: ${content.body}`}
      drag={swipeable && isPresent ? 'x' : false}
      dragDirectionLock
      dragMomentum={false}
      dragElastic={0.9}
      whileDrag={{ zIndex: 2 }}
      onDragStart={() => {
        rowDraggedRef.current = true;
        setLifted(true);
        onSwipeStart(item.key);
      }}
      onDragEnd={handleDragEnd}
      onPointerDown={() => { rowDraggedRef.current = false; }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        if (e.key === 'Escape') islandDismiss(item.key);
      }}
    >
      <Leading content={content} size={40} />
      <div className={styles.text}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{content.title}</span>
          {item.count > 1 ? <span className={styles.count}>{item.count}</span> : null}
        </div>
        <div key={item.revision} className={styles.body}>
          {content.actor ? <span className={styles.actor}>{content.actor}: </span> : null}
          {content.body}
        </div>
      </div>
    </motion.div>
  );
});

export default function NotificationIsland() {
  const { items, closing } = useSyncExternalStore(islandSubscribe, islandSnapshot, islandSnapshot);
  const reduceMotion = useReducedMotion();
  const phaseRef = useRef('hidden');
  const runRef = useRef(0);
  const draggedRef = useRef(false);
  const swipingRef = useRef(false);
  const pressRef = useRef(false);
  const liftedRef = useRef(false);
  const draggingRef = useRef(new Set()); // row keys under a finger
  const flingingRef = useRef(new Set()); // row keys flying off

  // Everything the island animates. One owner each; resets are jumps.
  // The shape: pill <-> card progress, the card's height on the rows'
  // spring, and the bottom of the lowest row actually on screen. While the
  // card grows, its edge is held to that row, so new space never opens
  // ahead of the content; while it shrinks, the row fading out covers it.
  const openness = useMotionValue(0);
  const cardHeight = useMotionValue(ROW_H);
  const cardTargetRef = useRef(ROW_H);
  const rowsBottom = useMotionValue(0);
  const fullWidth = useMotionValue(expandedWidth());
  const shape = useTransform([openness, cardHeight, rowsBottom, fullWidth], ([o, h, bottom, w]) => {
    const growing = cardTargetRef.current > h + 0.5;
    return shapeClip(o, growing && bottom > 0 ? Math.min(h, bottom) : h, w);
  });
  const rowYs = useRef(new Map()); // key -> { y, present }
  const measureRows = useCallback(() => {
    let bottom = 0;
    rowYs.current.forEach(({ y, present }) => { if (present) bottom = Math.max(bottom, y.get() + ROW_H); });
    rowsBottom.set(bottom);
  }, [rowsBottom]);
  const trackRow = useCallback((key, y, present) => {
    rowYs.current.set(key, { y, present });
    const stop = y.on('change', measureRows);
    measureRows();
    return () => {
      stop();
      rowYs.current.delete(key);
      measureRows();
    };
  }, [measureRows]);
  const lift = useMotionValue(0);
  const shellClip = useTransform([shape, lift], ([s, l]) => (l ? liftClip(s) : s));
  const borderClip = useTransform(shape, frameClip);
  const stageX = useMotionValue(0);
  const stageY = useMotionValue(0);
  const stageScale = useMotionValue(1);
  const stageOpacity = useMotionValue(0);
  const initialLogo = logoPill(fullWidth.get());
  // The mark and the dot: their own entrance (fading and settling into the
  // pill) times how far the pill has opened, so during the stretch and the
  // gathering back they follow the shape exactly - one driver, no separate
  // animation to fall out of step or cancel another.
  const logoScale = useMotionValue(1); // entrance
  const logoOpacity = useMotionValue(1); // entrance
  const dotOpacity = useMotionValue(1); // entrance
  const dotScale = useMotionValue(1); // entrance
  const logoX = useTransform([openness, fullWidth], ([o, w]) => {
    const from = logoPill(w).x;
    return from + (LOGO_AVATAR.x - from) * clamp01(o);
  });
  const logoY = useTransform(openness, (o) => initialLogo.y + (LOGO_AVATAR.y - initialLogo.y) * clamp01(o));
  const logoShownScale = useTransform([logoScale, openness], ([s, o]) => s * (1 - (1 - LOGO_MIN_SCALE) * clamp01(o)));
  const logoShownOpacity = useTransform([logoOpacity, openness], ([a, o]) => a * clamp01(1 - o / LOGO_FADE_BY));
  const dotShownScale = useTransform([dotScale, openness], ([s, o]) => s * (1 - 0.6 * clamp01(o / DOT_FADE_BY)));
  const dotShownOpacity = useTransform([dotOpacity, openness], ([a, o]) => a * clamp01(1 - o / DOT_FADE_BY));
  const contentOpacity = useMotionValue(0);
  const contentScale = useMotionValue(CONTENT_FROM);

  const count = items.length;
  // Which rows are showing, not just how many: a queued one swapping in for
  // one that left changes the island as much as an arrival does.
  const layoutKey = items.map((i) => i.key).join('|');
  const spring = reduceMotion ? REDUCED : SPRING;
  const motionRef = useRef({ spring, reduceMotion });
  motionRef.current = { spring, reduceMotion };
  const morphingRef = useRef(false); // pill -> card still under way
  const expandAtRef = useRef(0); // when (performance.now) the card stretch starts

  // Where rows new in this render start. While the content is not visible
  // yet (island opening, or gathering back into the pill) they are simply
  // placed; once it is, the new ones come down together from above the top.
  // They stack directly above wherever the current top row really is (it
  // may itself still be coming down), so arrivals in quick succession form
  // one block instead of starting on top of each other.
  const prevKeysRef = useRef(new Set());
  const placed = contentOpacity.get() < 0.3;
  const entering = items.filter((i) => !prevKeysRef.current.has(i.key)).length;
  let topY = Infinity;
  rowYs.current.forEach(({ y, present }, key) => {
    if (present && prevKeysRef.current.has(key)) topY = Math.min(topY, y.get());
  });
  if (!Number.isFinite(topY)) topY = 0;
  const enterFrom = (index) => (placed ? index : topY / ROW_H - (entering - index));
  useEffect(() => { prevKeysRef.current = new Set(items.map((i) => i.key)); }, [items]);

  // ---- press: pauses clocks and holds the visible set -------------------
  // Released from the window, so a finger lifted off the island (or a drag
  // that ends elsewhere) still releases it.
  const pressEnd = useCallback(() => {
    if (!pressRef.current) return;
    pressRef.current = false;
    window.removeEventListener('pointerup', pressEnd, true);
    window.removeEventListener('pointercancel', pressEnd, true);
    islandResume('press');
    islandRelease('press');
  }, []);
  const pressStart = useCallback(() => {
    draggedRef.current = false;
    if (pressRef.current) return;
    pressRef.current = true;
    islandPause('press');
    islandHold('press');
    window.addEventListener('pointerup', pressEnd, true);
    window.addEventListener('pointercancel', pressEnd, true);
  }, [pressEnd]);
  useEffect(() => () => {
    pressEnd();
    islandRelease('lift');
    islandRelease('swipe');
    islandResume('motion');
  }, [pressEnd]);

  // ---- a row lifted out by a swipe ---------------------------------------
  const endLift = useCallback(() => {
    draggingRef.current.clear();
    flingingRef.current.clear();
    if (!liftedRef.current) return;
    liftedRef.current = false;
    lift.set(0);
    islandRelease('lift');
  }, [lift]);

  // The clip closes again once no row is held or flying. The rows below a
  // dismissed one are already sliding up under the shape's spring, so
  // nothing has to wait for them.
  const tryUnlift = useCallback(() => {
    if (!liftedRef.current) return;
    if (draggingRef.current.size || flingingRef.current.size) return;
    endLift();
  }, [endLift]);

  const handleRowSwipeStart = useCallback((key) => {
    draggingRef.current.add(key);
    if (liftedRef.current) return;
    liftedRef.current = true;
    islandHold('lift');
    lift.set(1);
  }, [lift]);
  const handleRowSwipeEnd = useCallback((key, flung) => {
    draggingRef.current.delete(key);
    if (flung) flingingRef.current.add(key);
  }, []);
  const handleRowFlingDone = useCallback((key) => {
    flingingRef.current.delete(key);
    islandDismissNow(key);
    tryUnlift();
  }, [tryUnlift]);

  // Keep the island in step with the viewport.
  useEffect(() => {
    const onResize = () => {
      fullWidth.set(expandedWidth());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fullWidth]);

  // Drive the shell to match the store: which rows, and whether it is closing.
  //
  // No row's time may run out while the island is reshaping: a row expiring
  // halfway through the card growing for a new arrival yanked it out mid-
  // motion. Clocks pause ('motion') for every change and resume when it has
  // settled, each row then keeping at least the store's minimum resume time,
  // so a leave always starts from a still island.
  useEffect(() => {
    if (swipingRef.current) return;
    const run = ++runRef.current;
    const alive = () => run === runRef.current;
    const { spring: sp, reduceMotion: reduced } = motionRef.current;
    const morph = reduced ? REDUCED : MORPH;
    const pop = reduced ? REDUCED : POP;
    const go = (value, to, transition) => animate(value, to, transition);

    // A row that left while held (dismissed elsewhere) can no longer end its
    // gesture; forget it so the clip can close.
    const keys = new Set(islandSnapshot().items.map((i) => i.key));
    draggingRef.current.forEach((k) => { if (!keys.has(k)) draggingRef.current.delete(k); });
    flingingRef.current.forEach((k) => { if (!keys.has(k)) flingingRef.current.delete(k); });
    tryUnlift();

    if (count === 0) {
      endLift();
      islandResume('motion');
      phaseRef.current = 'hidden';
      stageOpacity.jump(0);
      stageX.jump(0);
      return;
    }

    if (closing) {
      endLift();
      islandResume('motion');
      phaseRef.current = 'collapsing';
      // The opening in reverse. The card gathers back into the pill, its
      // content shrinking and fading with it while the mark grows back
      // (the mark follows openness). Only once the pill has come to rest is
      // it seen for a beat; then the dot and the mark go and it shrinks
      // away. Each step starts from a still shape, never mid-spring.
      const gather = reduced ? REDUCED : GATHER;
      go(contentOpacity, 0, { duration: reduced ? 0.12 : 0.3, ease: EASE_IN_OUT });
      go(contentScale, CONTENT_FROM, gather);
      logoScale.jump(1);
      logoOpacity.jump(1);
      dotScale.jump(1);
      dotOpacity.jump(1);
      morphingRef.current = false;
      go(openness, 0, gather)
        .then(() => {
          if (!alive()) return null;
          const beat = reduced ? 0 : 0.2;
          const away = { duration: reduced ? 0.14 : 0.34, delay: beat + 0.08, ease: EASE_IN_OUT };
          go(dotOpacity, 0, { duration: 0.18, delay: beat, ease: EASE_IN_OUT });
          go(dotScale, 0.3, { duration: 0.2, delay: beat, ease: EASE_IN_OUT });
          go(logoOpacity, 0, { duration: 0.22, delay: beat + 0.04, ease: EASE_IN_OUT });
          go(logoScale, 0.5, { duration: 0.26, delay: beat + 0.04, ease: EASE_IN_OUT });
          go(stageY, reduced ? 0 : -12, away);
          go(stageScale, reduced ? 1 : 0.55, away);
          return go(stageOpacity, 0, { ...away, delay: away.delay + 0.06 });
        })
        .then(() => {
          if (!alive()) return;
          phaseRef.current = 'hidden';
          islandFinish();
        });
      return;
    }

    const from = phaseRef.current;
    if (from === 'hidden') {
      // Start from a small pill just above its place; every value is set
      // now, synchronously, so nothing below can start from a stale one.
      openness.jump(0);
      cardTargetRef.current = count * ROW_H;
      cardHeight.jump(count * ROW_H);
      stageX.jump(0);
      stageY.jump(reduced ? 0 : -14);
      stageScale.jump(reduced ? 1 : 0.55);
      stageOpacity.jump(0);
      logoScale.jump(reduced ? 1 : 0.5);
      logoOpacity.jump(0);
      dotOpacity.jump(0);
      dotScale.jump(reduced ? 1 : 0.2);
      contentOpacity.jump(0);
      contentScale.jump(CONTENT_FROM);
      // Beat one: the pill arrives, and the mark and the dot settle into it.
      go(stageY, 0, pop);
      go(stageScale, 1, pop);
      go(stageOpacity, 1, { duration: 0.22, ease: EASE_OUT });
      // (Only the entrance animates these; the stretch never touches them,
      // so it cannot cancel them - a motion value runs one animation at a
      // time, and that once left the pill empty.)
      go(logoScale, 1, { ...pop, delay: 0.06 });
      go(dotScale, 1, { ...pop, delay: 0.14 });
      go(logoOpacity, 1, { duration: 0.26, delay: 0.06, ease: EASE_OUT });
      go(dotOpacity, 1, { duration: 0.22, delay: 0.14, ease: EASE_OUT });
      morphingRef.current = true;
      expandAtRef.current = performance.now() + (reduced ? 0 : PILL_BEAT * 1000);
    } else {
      if (from === 'collapsing') {
        morphingRef.current = true;
        expandAtRef.current = performance.now();
        // It may have been on its way out: the mark and the dot come back.
        go(logoOpacity, 1, { duration: 0.18, ease: EASE_OUT });
        go(logoScale, 1, morph);
        go(dotOpacity, 1, { duration: 0.18, ease: EASE_OUT });
        go(dotScale, 1, morph);
      }
      // Coming back from a collapse that was interrupted (no-ops otherwise).
      go(stageY, 0, sp);
      go(stageScale, 1, sp);
      go(stageOpacity, 1, { duration: 0.14, ease: EASE_OUT });
    }

    // Beat two, from the pill: the card stretches out once the pill has
    // settled. Rows arriving meanwhile join the same stretch (same spring,
    // same start) instead of cutting it short. Between row counts, once
    // open, the shape moves on the rows' own spring so its edge stays on
    // the last row.
    const lead = morphingRef.current ? Math.max(0, (expandAtRef.current - performance.now()) / 1000) : 0;
    phaseRef.current = 'expanding';
    islandPause('motion');
    Promise.all([
      // The rows run this spring from this moment (each Row starts its own
      // on the same render); its end is when they have settled.
      animate(0, 1, sp),
      go(openness, 1, { ...morph, delay: lead }),
      go(cardHeight, (cardTargetRef.current = count * ROW_H), sp),
      go(contentScale, 1, { ...morph, delay: lead }),
      go(contentOpacity, 1, { duration: 0.28, delay: lead + 0.04, ease: EASE_OUT }),
    ]).then(() => {
      if (!alive()) return;
      morphingRef.current = false;
      phaseRef.current = 'expanded';
      islandMarkShown();
      islandResume('motion');
    });
  }, [
    layoutKey, count, closing, endLift, tryUnlift, openness, cardHeight, stageX, stageY, stageScale, stageOpacity,
    logoScale, logoOpacity, dotOpacity, dotScale, contentOpacity, contentScale,
  ]);

  // The whole island is swiped (one notification): nothing new is promoted
  // into it from the moment the drag starts until it has gone or settled.
  const handleDragStart = useCallback(() => {
    draggedRef.current = true;
    islandHold('swipe');
  }, []);

  // A release keeps the finger's speed: away if far or fast enough,
  // otherwise back to rest, both on a spring seeded with the drag velocity.
  const handleDragEnd = useCallback((_e, info) => {
    const { x: dx } = info.offset;
    const { x: vx } = info.velocity;
    const flung = Math.abs(dx) > SWIPE_DISTANCE || Math.abs(vx) > SWIPE_VELOCITY;
    if (!flung) {
      animate(stageX, 0, { type: 'spring', stiffness: 500, damping: 40, velocity: vx })
        .then(() => islandRelease('swipe'));
      return;
    }
    const dir = (Math.abs(vx) > SWIPE_VELOCITY ? vx : dx) > 0 ? 1 : -1;
    const swiped = islandSnapshot().items.map((i) => i.key);
    const run = ++runRef.current;
    swipingRef.current = true;
    animate(stageX, dir * (window.innerWidth * 0.6 + expandedWidth()), {
      type: 'spring', stiffness: 220, damping: 32, velocity: vx, restDelta: 2,
    });
    animate(stageOpacity, 0, { duration: 0.24, delay: 0.06, ease: EASE_IN }).then(() => {
      swipingRef.current = false;
      if (run !== runRef.current) { islandRelease('swipe'); return; }
      // Gone: the island is hidden again, and whatever comes next opens
      // from the pill like any first notification.
      phaseRef.current = 'hidden';
      stageX.jump(0);
      swiped.forEach((key) => islandDismissNow(key));
      islandRelease('swipe');
    });
  }, [stageX, stageOpacity]);

  const wasDragged = useCallback(() => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  return (
    <div className={styles.host} aria-live="polite">
      <motion.div
        className={styles.stage}
        // The stage is a full 380x192 box; only the clipped shell inside it
        // may take touches, or it would block the page under its empty area.
        style={{ x: stageX, y: stageY, scale: stageScale, opacity: stageOpacity, pointerEvents: 'none' }}
        drag={count === 1 ? 'x' : false}
        dragDirectionLock
        dragMomentum={false}
        dragElastic={0.9}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onPointerDown={pressStart}
        onHoverStart={() => islandPause('hover')}
        onHoverEnd={() => islandResume('hover')}
      >
        <motion.div data-island-frame className={styles.frame} style={{ clipPath: borderClip }} />
        <motion.div
          data-island-shell
          className={styles.shell}
          style={{ clipPath: shellClip, pointerEvents: count ? 'auto' : 'none' }}
        >
          <motion.div data-island-bg className={styles.backdrop} style={{ clipPath: shape }} />
          <motion.img
            data-island-logo
            src={logo}
            alt=""
            aria-hidden="true"
            draggable={false}
            className={styles.logo}
            style={{ x: logoX, y: logoY, scale: logoShownScale, opacity: logoShownOpacity }}
          />
          <motion.span
            data-island-dot
            aria-hidden="true"
            className={styles.dot}
            style={{ opacity: dotShownOpacity, scale: dotShownScale }}
          />
          <motion.div
            data-island-expanded
            className={styles.expanded}
            style={{ opacity: contentOpacity, scale: contentScale }}
          >
            <AnimatePresence initial={false}>
              {items.map((item, index) => (
                <Row
                  key={item.key}
                  item={item}
                  index={index}
                  last={index === count - 1}
                  enterFrom={enterFrom(index)}
                  spring={spring}
                  wasDragged={wasDragged}
                  swipeable={count > 1}
                  onSwipeStart={handleRowSwipeStart}
                  onSwipeEnd={handleRowSwipeEnd}
                  onFlingDone={handleRowFlingDone}
                  onSettled={tryUnlift}
                  track={trackRow}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
