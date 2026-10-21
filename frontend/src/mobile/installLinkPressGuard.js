/**
 * Holding a link does nothing in the installed app.
 *
 * In a browser, holding a link (a username, a community, any <a href>) lifts a
 * preview of it: the link's text and address in a box that follows the finger.
 * On Android that box is the WebView starting a DRAG of the link — Chromium
 * treats every anchor as draggable, and a long press is how a touch drag
 * begins — so it appears however `user-select` and `-webkit-touch-callout`
 * are set (mobile.css already turns both off for everything; the latter is
 * WebKit/iOS only and never did anything for this). That attribution comes from
 * the Chromium/WebView behaviour and reports of the same box in other WebView
 * apps; it has not been confirmed on a device here. The website keeps the
 * behaviour; the app has no use for it, since the app decides what a long
 * press on a profile or a message means.
 *
 * Two events start it, so both are cancelled:
 *   dragstart    the drag itself, for a link or an image inside one.
 *   contextmenu  the long press's own event; cancelling it also stops the
 *                browser from going on to the link menu / drag.
 *
 * What is deliberately left alone: editable fields. A long press there is the
 * caret / selection handles / paste menu, and dragging selected text inside a
 * field is editing. Handlers are not stopped from propagating, so the app's own
 * `onContextMenu` (message actions) still runs.
 *
 * Mobile entry only: the website's entry never imports this.
 */

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const LINK_OR_IMAGE = 'a[href], img';

/** The element a (possibly text-node) event target belongs to. */
function elementOf(target) {
  if (!target) return null;
  return target.nodeType === 1 ? target : target.parentElement;
}

/** True when a long press / drag on `target` is the app's to suppress. */
export function isLinkPress(target, selector = 'a[href]') {
  const el = elementOf(target);
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest(EDITABLE)) return false;
  return Boolean(el.closest(selector));
}

/**
 * @param {Document} [doc]
 * @returns {() => void} remove the listeners
 */
export function installLinkPressGuard(doc = document) {
  const onContextMenu = (event) => {
    if (isLinkPress(event.target)) event.preventDefault();
  };
  const onDragStart = (event) => {
    if (isLinkPress(event.target, LINK_OR_IMAGE)) event.preventDefault();
  };
  doc.addEventListener('contextmenu', onContextMenu);
  doc.addEventListener('dragstart', onDragStart);
  return () => {
    doc.removeEventListener('contextmenu', onContextMenu);
    doc.removeEventListener('dragstart', onDragStart);
  };
}
