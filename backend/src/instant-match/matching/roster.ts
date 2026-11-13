/**
 * The "searching now" roster: who a viewer sees first (owner decisions D2, D3).
 *
 * It used to be the oldest 50 waiters, the same list for everyone. It is now
 * ranked for each viewer by the same compatibility score matching uses, with
 * two adjustments that only make sense for a list a person browses:
 *
 *  - People searching for the viewer's own activity come first (the roster
 *    shows every activity; matching only ever pairs within one).
 *  - Someone who has passed on the viewer sinks, more each time (D3). Nobody
 *    is hidden or blocked from being asked — a request is still allowed —
 *    but a person who keeps saying no is no longer near the top of the list
 *    of the person they keep saying no to.
 */
export const ROSTER = {
  /** Waiters ranked per read, oldest first; the same bound as matching. */
  scanLimit: 200,
  /** How many the viewer is shown. */
  limit: 50,
  /** Score points added for searching for the viewer's activity. */
  sameActivityBonus: 10,
  /** Visibility is multiplied by this for each time this person passed on
   *  the viewer inside the feedback window. */
  passedOnViewerFactor: 0.6,
  /** The viewer-independent waiter list is shared for this long. */
  snapshotTtlMs: 1000,
} as const;

/** 0..~110: how high a waiter sits on one viewer's roster. */
export function rosterVisibility(
  score: number,
  opts: { sameActivity: boolean; passedOnViewer: number },
): number {
  const base = score + (opts.sameActivity ? ROSTER.sameActivityBonus : 0);
  return base * ROSTER.passedOnViewerFactor ** Math.max(0, opts.passedOnViewer);
}
