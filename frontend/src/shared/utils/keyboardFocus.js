/**
 * Keeps the focused field visible above an overlaying keyboard.
 *
 * In the installed Android app the keyboard OVERLAYS the page: the WebView no
 * longer resizes for it (SystemUiPlugin), so the browser's own "scroll the
 * focused field into view" never runs — that is triggered by the resize. This
 * is its replacement, called once per keyboard show (useKeyboardInset), with
 * the keyboard's final height, before the keyboard has moved.
 *
 * Rules, each because the alternative already misbehaved somewhere:
 *   - nothing happens when the field is already visible: a page that jumps on
 *     every focus is worse than one that never scrolls;
 *   - it scrolls by exactly the overlap, never `scrollIntoView({block:
 *     'center'})`, which moves a field that only needed a few pixels half a
 *     screen and drags fixed-height chat panes with it;
 *   - it scrolls the field's nearest scrollable ancestor, or the window if it
 *     has none, the same container a finger would have scrolled;
 *   - nothing happens for a field inside `[data-keyboard-dock]`: a composer
 *     docked at the bottom rises with the keyboard by its own transform, so
 *     it will be visible without the page moving (and its rect, read before
 *     that transition, would claim otherwise);
 *   - when the field sits in a form with a primary action marked
 *     `data-keyboard-reveal` (the auth screens' submit button), the part to
 *     show is the field down to that button, provided both fit above the
 *     keyboard together; if they do not, the field alone. A person typing the
 *     last field of a short form should not have to scroll for the button;
 *   - smooth while the keyboard animates (the browser's compositor-driven
 *     smooth scroll, which runs off the main thread and lasts roughly as long
 *     as the IME slide), instant with reduced motion or no animation.
 */

/** Space kept between the field and the keyboard's top edge. */
const FOCUS_MARGIN_PX = 12;

const isEditable = (el) => {
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
};

/** The nearest ancestor that can scroll vertically, or null for the window. */
export function scrollableAncestor(el) {
  for (let node = el?.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

/**
 * The part of the field that has to be seen: the caret's line in a
 * contenteditable (a long draft can be taller than the space above the
 * keyboard), otherwise the field itself.
 */
function targetRect(el) {
  const rect = el.getBoundingClientRect();
  if (!el.isContentEditable) return rect;
  try {
    const sel = window.getSelection?.();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      const caret = sel.getRangeAt(0).getBoundingClientRect();
      // An empty line reports a zero rect; the field's own box is right then.
      if (caret && caret.height > 0) return caret;
    }
  } catch {
    // Selection APIs can throw on detached ranges; the field's box will do.
  }
  return rect;
}

/**
 * The field's rect, stretched down to the form's primary action when the two
 * fit above the keyboard together (see the rules at the top of this file).
 */
function withPrimaryAction(el, rect, limit, margin) {
  const action = el.closest?.('form')?.querySelector('[data-keyboard-reveal]');
  if (!action || action === el) return rect;
  const below = action.getBoundingClientRect();
  if (below.bottom <= rect.bottom) return rect;
  // Both must fit between the top of the screen and the keyboard.
  if (below.bottom - rect.top > limit - margin) return rect;
  return { top: rect.top, bottom: below.bottom, height: below.bottom - rect.top };
}

/**
 * @param {object} options
 * @param {number} options.inset     how far up from the bottom of the layout
 *                                   viewport the keyboard reaches, in CSS px
 * @param {number} [options.duration] the keyboard's animation, ms (0 = instant)
 * @param {number} [options.margin]  space to keep above the keyboard
 * @returns {number} how far it scrolled (0 when the field was already visible)
 */
export function ensureFocusedVisible({ inset, duration = 0, margin = FOCUS_MARGIN_PX } = {}) {
  if (typeof document === 'undefined' || !(inset > 0)) return 0;
  const el = document.activeElement;
  if (!isEditable(el)) return 0;
  if (el.closest?.('[data-keyboard-dock]')) return 0;

  const limit = window.innerHeight - inset - margin;
  const rect = withPrimaryAction(el, targetRect(el), limit, margin);
  let overlap = Math.ceil(rect.bottom - limit);
  if (overlap <= 0) return 0;
  // Never past the field's top: in a field taller than the space left, its
  // start (where the caret usually is on focus) stays on screen.
  overlap = Math.min(overlap, Math.max(0, Math.floor(rect.top - margin)));
  if (overlap <= 0) return 0;

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const behavior = duration > 0 && !reduced ? 'smooth' : 'instant';
  const scroller = scrollableAncestor(el);
  if (scroller) scroller.scrollBy({ top: overlap, behavior });
  else window.scrollBy({ top: overlap, behavior });
  return overlap;
}
