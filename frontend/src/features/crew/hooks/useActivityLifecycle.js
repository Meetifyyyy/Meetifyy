import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Time-derived activity state that updates itself while the page stays open.
 *
 * "Started" and "ended" are not stored statuses — they are facts about the
 * clock. Computing them once during render meant a detail page opened five
 * minutes before the start time kept showing the join button forever: nothing
 * re-rendered at the boundary, so the user had to refresh or navigate away and
 * back. This hook makes the boundary itself an event.
 *
 * Three mechanisms, deliberately overlapping, because each one alone has a
 * hole:
 *
 *  1. A timer armed for the exact next boundary (start, then end). Precise and
 *     works with no network at all — but browsers throttle or suspend timers in
 *     a background tab, so it can fire late.
 *  2. Re-evaluation whenever the tab becomes visible or the window regains
 *     focus, which is exactly when a throttled timer would have drifted. This
 *     also triggers `onBoundary` so the caller can revalidate against the
 *     server.
 *  3. The caller's realtime subscription (`activity.started` / `activity.updated`),
 *     which corrects the stored status — cancelled, ended — that no client-side
 *     clock can infer.
 *
 * Clock skew: the server stamps `serverNow` on the detail payload. The offset
 * between that and the device clock is applied to every comparison, so a device
 * running minutes fast or slow still flips at the real start instant rather
 * than at its own idea of it.
 */

/** Longest single setTimeout we arm; longer waits are re-armed in chunks. */
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6h — well inside the 32-bit limit

function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Derives the end instant. An activity with no explicit end is treated as
 * lasting `duration` hours (default 1) from its start — the same rule the
 * detail page has always used, kept in one place now.
 */
export function resolveEndTime(activity) {
  const explicit = toTime(activity?.endDate);
  if (explicit) return explicit;

  const start = toTime(activity?.startDate || activity?.date);
  if (!start) return null;

  let hours = 1;
  const match = String(activity?.duration ?? '').match(/(\d+)/);
  if (match) hours = parseInt(match[1], 10) || 1;
  return start + hours * 60 * 60 * 1000;
}

export function useActivityLifecycle(activity, { onBoundary } = {}) {
  // Offset = serverClock - deviceClock, captured when the payload arrives.
  const serverOffsetRef = useRef(0);
  const serverNow = activity?.serverNow;
  useEffect(() => {
    const stamped = toTime(serverNow);
    if (stamped) serverOffsetRef.current = stamped - Date.now();
  }, [serverNow]);

  // Bumping this re-runs the derivation below. The value itself is meaningless;
  // it exists so a boundary can force a render.
  const [tick, setTick] = useState(0);
  const bump = () => setTick(t => t + 1);

  const startTime = toTime(activity?.startDate || activity?.date);
  const endTime = resolveEndTime(activity);
  const status = activity?.status;

  const onBoundaryRef = useRef(onBoundary);
  useEffect(() => { onBoundaryRef.current = onBoundary; }, [onBoundary]);

  useEffect(() => {
    if (!activity) return undefined;

    let timer = null;
    let cancelled = false;

    const now = () => Date.now() + serverOffsetRef.current;

    const arm = () => {
      if (cancelled) return;
      // The next instant at which the derived state changes. Once both have
      // passed there is nothing left to wait for and no timer is armed.
      const next = [startTime, endTime]
        .filter(t => typeof t === 'number' && t > now())
        .sort((a, b) => a - b)[0];
      if (!next) return;

      const wait = Math.min(next - now(), MAX_TIMEOUT_MS);
      timer = setTimeout(() => {
        timer = null;
        if (cancelled) return;
        bump();
        // Only a real boundary crossing asks the caller to revalidate; a
        // chunked re-arm of a long wait must not fire a request.
        if (now() >= next) onBoundaryRef.current?.();
        arm();
      }, Math.max(wait, 0));
    };

    // A tab that was backgrounded across the start time comes back with a
    // throttled (or never-fired) timer. Re-deriving on the way in closes that
    // gap, and re-arming keeps the remaining boundary honest.
    const resync = () => {
      if (document.visibilityState === 'hidden') return;
      bump();
      onBoundaryRef.current?.();
      if (timer) { clearTimeout(timer); timer = null; }
      arm();
    };

    arm();
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
    // `status` participates so a server-side cancel/end re-arms against the
    // new reality rather than leaving a timer aimed at a stale boundary.
  }, [activity, startTime, endTime, status]);

  return useMemo(
    () => deriveActivityPhase(activity, Date.now() + serverOffsetRef.current),
    // `tick` is the whole point: a boundary timer bumps it, which is what
    // re-derives the phase without any new data arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startTime, endTime, status, tick],
  );
}

/**
 * The pure half of the hook: given an activity and an instant, what state is it
 * in? Kept separate so the rule can be tested directly, and so every caller
 * (hook, card, test) answers the question identically.
 */
export function deriveActivityPhase(activity, nowMs = Date.now()) {
  const status = activity?.status;
  const startTime = toTime(activity?.startDate || activity?.date);
  const endTime = resolveEndTime(activity);

  const isCancelled = status === 'CANCELLED';
  // The stored status is authoritative when it is terminal; the clock only ever
  // adds an ending, it never un-ends something the server closed.
  const hasEnded =
    isCancelled ||
    status === 'ENDED' ||
    status === 'COMPLETED' ||
    (typeof endTime === 'number' && nowMs >= endTime);
  const hasStarted = typeof startTime === 'number' && nowMs >= startTime;

  return {
    isCancelled,
    hasStarted,
    hasEnded,
    // The single label the action bar renders, so start/end/cancel can never be
    // shown in a contradictory combination.
    phase: isCancelled ? 'CANCELLED' : hasEnded ? 'ENDED' : hasStarted ? 'STARTED' : 'UPCOMING',
    startTime,
    endTime,
  };
}
