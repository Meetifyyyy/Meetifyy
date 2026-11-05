import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'framer-motion';
import Avatar from '../../components/avatar/Avatar';
import CalendarIcon from '../../components/ui/CalendarIcon';
import { DEFAULT_ACTIVITY_COVERS, getDefaultActivityCover } from '../../utils/activityCover';
import logo from '@assets/images/meetify_logo.webp';
import {
  islandDismiss,
  islandDismissNow,
  islandFinish,
  islandMarkShown,
  islandPause,
  islandResume,
  islandSnapshot,
  islandSubscribe,
} from './islandStore';
import styles from './NotificationIsland.module.css';

/*
 * The single host for instant notifications. One shell moves through:
 * hidden -> pill -> expanded (one row per notification, up to three) -> pill
 * -> hidden, and is never unmounted while it has work, so every change is one
 * continuous shape.
 *
 * Smoothness rules this file follows (each fixes something seen on device):
 * - Phases overlap. The pill starts expanding while it is still dropping in,
 *   and starts fading while it is still shrinking; awaiting one phase before
 *   the next read as a stop between two animations.
 * - A swipe moves only what is under the finger: the whole island when it
 *   shows one notification, otherwise just that row. While a row moves, the
 *   island's backdrop and border step aside (each row has its own
 *   background), so no empty white box is left standing behind it.
 * - A released swipe keeps the finger's speed: a spring seeded with the drag
 *   velocity, both for flinging away and for settling back. A fixed-duration
 *   tween started at its own speed, which read as a snap.
 * - Only transform and opacity animate on content. No filter (a blur is
 *   re-rasterised every frame) and no layout projection on rows.
 * - The shell never changes size. It is laid out once at its largest
 *   (full width, MAX_ROWS rows) and the visible shape is a clip-path inset
 *   that animates. Animating width/height re-ran layout and repainted the
 *   box and its shadow every frame on the main thread - the same thread
 *   rendering the incoming rows - which is what made rows arriving and
 *   leaving feel laggy.
 */

const PILL_W = 120;
const PILL_H = 36;
const ROW_H = 64;
const MAX_W = 380;
const RADIUS = 24;
const MAX_ROWS = 3;
const SHELL_H = ROW_H * MAX_ROWS;

// Critically damped (2 * sqrt(560) ~ 47): quick, no overshoot, no long tail.
const SPRING = { type: 'spring', stiffness: 560, damping: 48, mass: 1, restDelta: 0.5 };
const EASE_OUT = [0.22, 1, 0.36, 1];
const EASE_IN = [0.4, 0, 1, 1];
const REDUCED = { duration: 0.18, ease: EASE_OUT };

// The logo is a LOGO_BOX square (the artwork has generous padding, so the
// mark itself is about half of it). In the pill it sits at the left, with a
// blue dot at the right; expanded, it sits exactly where the top row's avatar
// is (row padding 12, avatar 40 in a 64 row), so it can dissolve into it.
const LOGO_BOX = 40;
const logoPill = (w) => ({ x: (w - PILL_W) / 2 - 2, y: (PILL_H - LOGO_BOX) / 2, scale: 1 });
const LOGO_AVATAR = { x: 12, y: (ROW_H - LOGO_BOX) / 2, scale: 1.15 };

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
const pillClip = () => clipFor(PILL_W, PILL_H, PILL_H / 2);
// The border frame is the shell's size plus 1px all round, placed at -1px;
// the same inset numbers then describe a rect 1px larger, one radius up.
const frameClip = (clip) => clip.replace(/round ([\d.]+)px/, (_m, r) => `round ${Number(r) + 1}px`);
const rowsClip = (n) => clipFor(expandedWidth(), n * ROW_H, RADIUS);

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

function Row({ item, index, spring, wasDragged, swipeable, onSwipeStart, onSwipeSettled }) {
  const { content } = item;
  const [rowRef, animateRow] = useAnimate();
  const rowDraggedRef = useRef(false);

  const handleDragEnd = useCallback((_e, info) => {
    islandResume('press');
    const { x: dx } = info.offset;
    const { x: vx } = info.velocity;
    if (Math.abs(dx) > SWIPE_DISTANCE || Math.abs(vx) > SWIPE_VELOCITY) {
      const dir = (Math.abs(vx) > SWIPE_VELOCITY ? vx : dx) > 0 ? 1 : -1;
      animateRow(rowRef.current, { x: dir * (window.innerWidth * 0.6 + expandedWidth()) }, {
        type: 'spring', stiffness: 220, damping: 32, velocity: vx, restDelta: 2,
      });
      animateRow(rowRef.current, { opacity: 0 }, { duration: 0.2, delay: 0.04, ease: EASE_IN })
        .then(() => islandDismissNow(item.key));
    } else {
      animateRow(rowRef.current, { x: 0 }, { type: 'spring', stiffness: 500, damping: 40, velocity: vx })
        .then(onSwipeSettled);
    }
  }, [animateRow, rowRef, item.key, onSwipeSettled]);

  const open = useCallback(() => {
    if (rowDraggedRef.current) {
      rowDraggedRef.current = false;
      return;
    }
    if (wasDragged()) return;
    item.onOpen?.();
    islandDismiss(item.key);
  }, [item, wasDragged]);

  return (
    <motion.div
      ref={rowRef}
      // Placed explicitly at index * ROW_H; no layout projection, which
      // snapped the rows below a new arrival and blanked them for a frame.
      className={`${styles.row}${index > 0 ? ` ${styles.rowDivided}` : ''}`}
      initial={{ opacity: 0, y: -ROW_H * 0.5 }}
      animate={{ opacity: 1, y: index * ROW_H }}
      exit={{ opacity: 0, y: index * ROW_H + ROW_H * 0.4 }}
      transition={{ y: spring, opacity: { duration: 0.2, ease: EASE_OUT } }}
      role="button"
      tabIndex={0}
      aria-label={`${content.title}: ${content.body}`}
      drag={swipeable ? 'x' : false}
      dragDirectionLock
      dragMomentum={false}
      dragElastic={0.9}
      onDragStart={() => { rowDraggedRef.current = true; onSwipeStart(); }}
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
}

export default function NotificationIsland() {
  const { items, closing } = useSyncExternalStore(islandSubscribe, islandSnapshot, islandSnapshot);
  const [scope, animate] = useAnimate();
  const reduceMotion = useReducedMotion();
  const phaseRef = useRef('hidden');
  const runRef = useRef(0);
  const draggedRef = useRef(false);
  const swipingRef = useRef(false);
  const [width, setWidth] = useState(expandedWidth);

  const count = items.length;
  const spring = reduceMotion ? REDUCED : SPRING;
  const motionRef = useRef({ spring, reduceMotion });
  motionRef.current = { spring, reduceMotion };

  const setClip = useCallback((clip, transition) => Promise.all([
    animate('[data-island-shell]', { clipPath: clip }, transition),
    animate('[data-island-frame]', { clipPath: frameClip(clip) }, transition),
  ]), [animate]);

  // The backdrop and border step aside while a single row is being swiped.
  const backdrop = useCallback((visible) => {
    animate('[data-island-bg], [data-island-frame]', { opacity: visible ? 1 : 0 }, { duration: visible ? 0.18 : 0.1 });
  }, [animate]);
  const handleRowSwipeStart = useCallback(() => backdrop(false), [backdrop]);
  const handleRowSwipeSettled = useCallback(() => backdrop(true), [backdrop]);

  useEffect(() => {
    const onResize = () => setWidth(expandedWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keep an expanded island in step with the viewport.
  useEffect(() => {
    if (!scope.current) return;
    if (phaseRef.current === 'expanded') {
      setClip(rowsClip(islandSnapshot().items.length), { duration: 0 });
    } else if (phaseRef.current === 'hidden') {
      setClip(pillClip(), { duration: 0 });
      animate('[data-island-logo]', logoPill(width), { duration: 0 });
    }
  }, [width, animate, scope, setClip]);

  // Drive the shell to match the store: how many rows, and whether it is closing.
  useEffect(() => {
    const shell = scope.current;
    if (!shell || swipingRef.current) return;
    const run = ++runRef.current;
    const alive = () => run === runRef.current;
    const { spring: sp, reduceMotion: reduced } = motionRef.current;

    if (count === 0) {
      phaseRef.current = 'hidden';
      animate(shell, { opacity: 0, x: 0 }, { duration: 0 });
      return;
    }

    if (closing) {
      phaseRef.current = 'collapsing';
      // Shrink, cross-fade content to logo, and start leaving while still
      // shrinking: one motion, not collapse-then-fade.
      animate('[data-island-expanded]', { opacity: 0 }, { duration: 0.18, ease: EASE_IN });
      animate('[data-island-logo]', { ...logoPill(expandedWidth()), opacity: 1 }, sp);
      animate('[data-island-dot]', { opacity: 1, scale: 1 }, { duration: 0.2, delay: 0.08, ease: EASE_OUT });
      setClip(pillClip(), sp);
      animate(shell, { y: -8, scale: 0.92, opacity: 0 }, { duration: reduced ? 0.14 : 0.26, delay: reduced ? 0 : 0.24, ease: EASE_IN })
        .then(() => {
          if (!alive()) return;
          phaseRef.current = 'hidden';
          islandFinish();
        });
      return;
    }

    const fromHidden = phaseRef.current === 'hidden';
    if (fromHidden) {
      setClip(pillClip(), { duration: 0 });
      animate(shell, { x: 0, y: -10, scale: 0.92, opacity: 0 }, { duration: 0 });
      animate('[data-island-logo]', { ...logoPill(expandedWidth()), opacity: 1 }, { duration: 0 });
      animate('[data-island-dot]', { opacity: 1, scale: 1 }, { duration: 0 });
      animate('[data-island-expanded]', { opacity: 0 }, { duration: 0 });
      animate(shell, { y: 0, scale: 1, opacity: 1 }, { duration: reduced ? 0.15 : 0.28, ease: EASE_OUT });
    } else {
      // Coming back from a collapse that was interrupted.
      animate(shell, { y: 0, scale: 1, opacity: 1 }, sp);
    }

    // Expansion overlaps the drop-in: the pill is briefly seen, never parked.
    const lead = fromHidden && !reduced ? 0.22 : 0;
    // A row swiped away, or a new arrival: the backdrop is back either way.
    animate('[data-island-bg], [data-island-frame]', { opacity: 1 }, { duration: fromHidden ? 0 : 0.18 });
    phaseRef.current = 'expanding';
    Promise.all([
      setClip(rowsClip(count), { ...sp, delay: lead }),
      animate('[data-island-dot]', { opacity: 0, scale: 0.4 }, { duration: 0.14, delay: lead, ease: EASE_IN }),
      animate('[data-island-logo]', LOGO_AVATAR, { ...sp, delay: lead }),
      animate('[data-island-logo]', { opacity: 0 }, { duration: 0.22, delay: lead + 0.08, ease: EASE_IN }),
      animate('[data-island-expanded]', { opacity: 1 }, { duration: 0.26, delay: lead + 0.06, ease: EASE_OUT }),
    ]).then(() => {
      if (!alive()) return;
      phaseRef.current = 'expanded';
      islandMarkShown();
    });
  }, [count, closing, animate, scope, setClip]);

  const handleDragStart = useCallback(() => {
    draggedRef.current = true;
  }, []);

  // A release keeps the finger's speed: away if far or fast enough,
  // otherwise back to rest, both on a spring seeded with the drag velocity.
  const handleDragEnd = useCallback((_e, info) => {
    islandResume('press');
    const shell = scope.current;
    if (!shell) return;
    const { x: dx } = info.offset;
    const { x: vx } = info.velocity;
    const flung = Math.abs(dx) > SWIPE_DISTANCE || Math.abs(vx) > SWIPE_VELOCITY;
    if (!flung) {
      animate(shell, { x: 0 }, { type: 'spring', stiffness: 500, damping: 40, velocity: vx });
      return;
    }
    const dir = (Math.abs(vx) > SWIPE_VELOCITY ? vx : dx) > 0 ? 1 : -1;
    // Only what was on screen when the swipe began goes; anything arriving
    // mid-swipe re-enters once the shell is clear.
    const swiped = islandSnapshot().items.map((i) => i.key);
    const run = ++runRef.current;
    swipingRef.current = true;
    animate(shell, { x: dir * (window.innerWidth * 0.6 + expandedWidth()) }, {
      type: 'spring', stiffness: 220, damping: 32, velocity: vx, restDelta: 2,
    });
    animate(shell, { opacity: 0 }, { duration: 0.24, delay: 0.06, ease: EASE_IN }).then(() => {
      swipingRef.current = false;
      if (run !== runRef.current) return;
      phaseRef.current = 'hidden';
      animate(shell, { x: 0 }, { duration: 0 });
      swiped.forEach((key) => islandDismissNow(key));
    });
  }, [animate, scope]);

  const wasDragged = useCallback(() => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  return (
    <div className={styles.host} aria-live="polite">
      <motion.div
        ref={scope}
        className={styles.stage}
        // The stage is a full 380x192 box; only the clipped shell inside it
        // may take touches, or it would block the page under its empty area.
        style={{ opacity: 0, pointerEvents: 'none' }}
        drag={count === 1 ? 'x' : false}
        dragDirectionLock
        dragMomentum={false}
        dragElastic={0.9}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onPointerDown={() => { draggedRef.current = false; islandPause('press'); }}
        onPointerUp={() => islandResume('press')}
        onPointerCancel={() => islandResume('press')}
        onHoverStart={() => islandPause('hover')}
        onHoverEnd={() => islandResume('hover')}
      >
        <div data-island-frame className={styles.frame} style={{ clipPath: frameClip(pillClip()) }} />
        <div data-island-shell className={styles.shell} style={{ clipPath: pillClip(), pointerEvents: count ? 'auto' : 'none' }}>
        <div data-island-bg className={styles.backdrop} />
        <motion.img
          data-island-logo
          src={logo}
          alt=""
          aria-hidden="true"
          draggable={false}
          className={styles.logo}
          style={logoPill(width)}
        />
        <motion.span data-island-dot aria-hidden="true" className={styles.dot} />
        <div data-island-expanded className={styles.expanded} style={{ opacity: 0 }}>
          <AnimatePresence initial={false}>
            {items.map((item, index) => (
              <Row
                key={item.key}
                item={item}
                index={index}
                spring={spring}
                wasDragged={wasDragged}
                swipeable={count > 1}
                onSwipeStart={handleRowSwipeStart}
                onSwipeSettled={handleRowSwipeSettled}
              />
            ))}
          </AnimatePresence>
        </div>
        </div>
      </motion.div>
    </div>
  );
}
