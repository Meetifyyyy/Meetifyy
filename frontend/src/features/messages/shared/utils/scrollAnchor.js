/**
 * Keeps the thread still when older messages are inserted above it.
 *
 * The old approach added the growth of `scrollHeight` to `scrollTop`. That is
 * only right when the browser does nothing itself, and Chromium does: with
 * `overflow-anchor: auto` (the web default) it already shifts `scrollTop` by
 * the inserted height during layout, so the manual shift doubled it and the
 * clamp at the end of the scroller landed the reader on the newest message.
 *
 * Measuring one message's offset from the scroller's top edge before and
 * after, and correcting only the difference, is right in both cases: when the
 * browser has already anchored, the difference is zero.
 */

/** The topmost message that is at least partly visible, and where it sits. */
export function captureScrollAnchor(container) {
  if (!container) return null;
  const top = container.getBoundingClientRect().top;
  const rows = container.querySelectorAll('[data-message-id]');
  for (let i = 0; i < rows.length; i += 1) {
    const rect = rows[i].getBoundingClientRect();
    if (rect.bottom > top) {
      return { id: rows[i].getAttribute('data-message-id'), offset: rect.top - top };
    }
  }
  return null;
}

/** Puts the captured message back where it was. Returns the shift applied. */
export function restoreScrollAnchor(container, anchor) {
  if (!container || !anchor?.id) return 0;
  const safe = (typeof CSS !== 'undefined' && CSS.escape)
    ? CSS.escape(anchor.id)
    : String(anchor.id).replace(/["\\]/g, '\\$&');
  const el = container.querySelector(`[data-message-id="${safe}"]`);
  if (!el) return 0;
  const offset = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const delta = offset - anchor.offset;
  if (delta !== 0) container.scrollTop += delta;
  return delta;
}
