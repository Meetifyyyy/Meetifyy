/**
 * Tracks which message is currently highlighted, so only ever one is.
 *
 * The old implementation was a bare `setTimeout` per flash with nothing holding
 * onto it, which broke in two ways the moment reply previews were clicked in
 * quick succession:
 *
 *   - Clicking reply A then reply B left A highlighted for the remainder of its
 *     own 1.8s, so two messages glowed at once and the earlier one faded at an
 *     unrelated moment.
 *   - Clicking the SAME reply twice restarted the animation but did not cancel
 *     the first timer, so that timer fired mid-way through the second highlight
 *     and cleared it early. The highlight appeared to flicker out.
 *
 * One tracked element and one tracked timer removes both: taking a new
 * highlight always releases the previous one first, whatever it was.
 */
export function createMessageHighlighter({
  className,
  durationMs = 1800,
  setTimer = (fn, ms) => window.setTimeout(fn, ms),
  clearTimer = (id) => window.clearTimeout(id),
}) {
  let current = null;
  let timerId = null;

  /** Removes the highlight from whatever holds it, and cancels its timer. */
  function clear() {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
    if (current) {
      current.classList.remove(className);
      current = null;
    }
  }

  /**
   * Highlights `el`, releasing any previous highlight first.
   *
   * The forced reflow between remove and add is what restarts the CSS
   * animation when the same element is targeted again; without it the browser
   * coalesces the two class mutations and nothing appears to happen.
   */
  function highlight(el) {
    if (!el) return;
    clear();
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    current = el;
    timerId = setTimer(() => {
      timerId = null;
      clear();
    }, durationMs);
  }

  return {
    highlight,
    clear,
    /** Test seam. */
    get currentElement() {
      return current;
    },
  };
}
