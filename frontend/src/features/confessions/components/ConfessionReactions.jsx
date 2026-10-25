import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CONFESSION_REACTIONS,
  REACTION_BY_KEY,
  describeReactions,
  reactionStateOf,
} from '@shared/lib/confessionReactions';
import ReactionCountsModal from './ReactionCountsModal';
import RollingCount from './RollingCount';
import styles from './ConfessionReactions.module.css';

/** Room the picker needs above its button before it opens below instead. */
const PICKER_CLEARANCE = 132;

/** How long an emoji (or the whole summary) takes to leave; matches the CSS. */
const LEAVE_MS = 200;

const byCount = (reactions) => (a, b) => reactions[b.key] - reactions[a.key];

/**
 * The kinds in the summary, in an order that never changes in front of you.
 *
 * Most first when the card first appears; after that a kind keeps its place
 * whatever the counts do, a new kind joins at the end, and a kind that drops
 * to zero is marked `leaving` (it shrinks away in its place) and removed once
 * that has played. Live updates and your own taps both go through here.
 */
function useStableKinds(reactions) {
  const present = CONFESSION_REACTIONS.filter((r) => reactions[r.key] > 0);
  const [items, setItems] = useState(() =>
    [...present].sort(byCount(reactions)).map((r) => ({ key: r.key, leaving: false, entering: false })));

  const presentKeys = new Set(present.map((r) => r.key));
  let changed = false;
  const next = items.map((item) => {
    const leaving = !presentKeys.has(item.key);
    if (leaving === item.leaving) return item;
    changed = true;
    return { ...item, leaving };
  });
  const held = new Set(items.map((i) => i.key));
  const added = present.filter((r) => !held.has(r.key)).sort(byCount(reactions));
  if (added.length > 0) {
    changed = true;
    next.push(...added.map((r) => ({ key: r.key, leaving: false, entering: true })));
  }
  if (changed) setItems(next);

  const anyLeaving = next.some((i) => i.leaving);
  useEffect(() => {
    if (!anyLeaving) return undefined;
    const t = setTimeout(() => setItems((cur) => cur.filter((i) => !i.leaving)), LEAVE_MS);
    return () => clearTimeout(t);
  }, [anyLeaving]);

  return changed ? next : items;
}

/**
 * Reacting to a confession. Two states:
 *
 *   - Nobody has reacted: a React button, which opens a picker of the five.
 *   - Any reactions: what everybody chose (each kind present, and the total),
 *     and nothing else. Tapping it opens every kind's count
 *     (ReactionCountsModal), and tapping a kind there is how you react,
 *     change it, or take yours back. Your own choice is not shown apart.
 *
 * Changes arrive from your taps and, live, from everyone else's: emoji keep
 * their places (useStableKinds), the total rolls to its new value, and going
 * between the two states fades rather than snaps.
 *
 * The picker closes on a choice, Escape or a tap anywhere else, and is a
 * radio group for the keyboard (arrows move, Enter or Space choose).
 */
export default function ConfessionReactions({ confession, onReact }) {
  const state = useMemo(() => reactionStateOf(confession), [confession]);
  const hasReactions = state.reactionCount > 0;
  const kinds = useStableKinds(state.reactions);
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  const [countsOpen, setCountsOpen] = useState(false);
  // After a choice, keyboard focus returns to whichever control is now shown.
  const [refocus, setRefocus] = useState(false);
  // The summary stays up while it fades out (the last reaction was taken
  // back), and once the two states have swapped, each new one fades in.
  const [summaryShown, setSummaryShown] = useState(hasReactions);
  const [swapped, setSwapped] = useState(false);
  if (hasReactions && !summaryShown) {
    setSummaryShown(true);
    setSwapped(true);
  }
  const summaryLeaving = summaryShown && !hasReactions;
  // What the summary last showed with reactions in it. When the last one is
  // taken back, the summary fades out as it was, rather than first rolling to
  // 0 and shrinking its emoji away.
  const [last, setLast] = useState({ count: state.reactionCount, kinds });
  if (hasReactions && (last.count !== state.reactionCount || last.kinds !== kinds)) {
    setLast({ count: state.reactionCount, kinds });
  }
  const shownCount = summaryLeaving ? last.count : state.reactionCount;
  const shownKinds = summaryLeaving ? last.kinds : kinds;
  useEffect(() => {
    if (!summaryLeaving) return undefined;
    const t = setTimeout(() => {
      setSummaryShown(false);
      setSwapped(true);
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [summaryLeaving]);

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const summaryRef = useRef(null);
  const itemRefs = useRef([]);
  const pickerId = useId();

  const closeCounts = useCallback(() => {
    setCountsOpen(false);
    setRefocus(true);
  }, []);

  // Not registered with the Back-button overlay stack, like the app's other
  // small popovers (ui/Menu): that pushes a history entry on every open and
  // pops it on every close, two router navigations per reaction, and a pop
  // still in flight could take the entry the next quick open pushed.
  const close = useCallback((withFocus = false) => {
    setOpen(false);
    if (withFocus) setRefocus(true);
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    // Opens upward over the card's own text unless the button is too close
    // to the top of the screen, where the header would cover it.
    const top = triggerRef.current?.getBoundingClientRect().top ?? Infinity;
    setBelow(top < PICKER_CLEARANCE);
    setOpen(true);
  }, [open, close]);

  const choose = useCallback((key) => {
    onReact?.(confession.id, state.myReaction === key ? null : key);
  }, [onReact, confession.id, state.myReaction]);

  // Any press outside the control closes the picker. `pointerdown`, so the
  // press that lands on another button still does what it was for.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close]);

  // A reaction landing swaps the React button for the summary: the picker
  // belongs to the button, so it goes with it.
  if (open && summaryShown) setOpen(false);

  useLayoutEffect(() => {
    if (open) itemRefs.current[0]?.focus({ preventScroll: true });
  }, [open]);

  useLayoutEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    (summaryRef.current || triggerRef.current)?.focus({ preventScroll: true });
  }, [refocus]);

  const onPickerKey = (e) => {
    const n = CONFESSION_REACTIONS.length;
    const at = itemRefs.current.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      close(e.key === 'Escape');
      return;
    }
    if (next !== null) {
      e.preventDefault();
      itemRefs.current[next]?.focus();
    }
  };

  if (summaryShown) {
    const summary = describeReactions(state);
    const yours = state.myReaction
      ? ` You reacted ${REACTION_BY_KEY[state.myReaction]?.label}.`
      : '';
    return (
      <div ref={rootRef} className={styles.root}>
        <button
          ref={summaryRef}
          type="button"
          className={`${styles.summary} ${swapped ? styles.fadeIn : ''}`}
          data-leaving={summaryLeaving ? '' : undefined}
          disabled={summaryLeaving}
          title={summary}
          aria-haspopup="dialog"
          aria-label={`${summary}.${yours} See all reactions`}
          onClick={() => setCountsOpen(true)}
        >
          <span className={styles.stack} aria-hidden="true">
            {shownKinds.map((k) => (
              <span
                key={k.key}
                className={styles.stackItem}
                data-leaving={k.leaving ? '' : undefined}
                data-entering={k.entering ? '' : undefined}
              >
                {REACTION_BY_KEY[k.key].emoji}
              </span>
            ))}
          </span>
          <span className={styles.count} aria-hidden="true">
            <RollingCount value={shownCount} />
          </span>
        </button>

        <ReactionCountsModal
          // Stays mounted while the summary fades, so a choice that took the
          // last reaction away still closes the modal with its animation.
          open={countsOpen}
          state={state}
          onClose={closeCounts}
          onChoose={choose}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${swapped ? styles.fadeIn : ''}`}
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? pickerId : undefined}
      >
        <ReactGlyph />
        <span>React</span>
      </button>

      {open && (
        <div
          id={pickerId}
          className={`${styles.picker} ${below ? styles.pickerBelow : ''}`}
          role="radiogroup"
          aria-label="Choose a reaction"
          onKeyDown={onPickerKey}
        >
          {CONFESSION_REACTIONS.map((r, i) => (
            <button
              key={r.key}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={false}
              tabIndex={i === 0 ? 0 : -1}
              className={styles.option}
              style={{ '--i': i }}
              onClick={() => {
                choose(r.key);
                close(true);
              }}
              title={r.label}
            >
              <span className={styles.optionEmoji} aria-hidden="true">{r.emoji}</span>
              <span className={styles.optionLabel}>{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A face with a plus: "add a reaction". */
function ReactGlyph() {
  return (
    <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.6 10.4A9 9 0 1 1 13.6 3.1" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" />
      <path d="M19 2v6M16 5h6" />
    </svg>
  );
}
