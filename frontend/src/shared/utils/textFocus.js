import { isTextFieldFocused } from '@shared/hooks/useKeyboardInset';

export { isTextFieldFocused };

/**
 * NOTE: menus no longer use the hold/restore helpers below; they close the
 * keyboard and open afterwards (`dismissKeyboardThen`, at the end of this file).
 * The helpers remain for other popovers that must keep a field focused.
 *
 * Keeping a text field focused while a popover (a select, a menu) is used.
 *
 * Tapping a <button> moves focus to it, so tapping a select's trigger while a
 * text field has focus BLURS that field, and the keyboard goes down. The page
 * then changes shape under the menu that was just opened (the viewport grows
 * back, the layout re-centres) and the menu, placed against the keyboard-up
 * geometry, has to jump to where its trigger now is. That jump was the
 * flicker. The keyboard was never meant to close: nothing about choosing a
 * value from a menu ends text entry.
 *
 * So the trigger declines the focus change instead (`holdTextFocus`), the field
 * keeps focus and the keyboard stays exactly where it was, and the menu is
 * measured once, against a viewport that does not move. The docked reply bar
 * does the same for its Send button (ReplyDock.jsx).
 *
 * Only when a TEXT field is focused. Otherwise the trigger takes focus as any
 * button does, so keyboard and screen-reader use is unchanged.
 */

/**
 * `onPointerDown` / `onMouseDown` for a popover's trigger. The click that
 * follows still fires; only the focus move is declined.
 */
export function holdTextFocus(event) {
  if (isTextFieldFocused()) event.preventDefault();
}

/**
 * The same for the open menu itself: choosing an option must not pull focus
 * off the field (a <button> option would, and so would tapping plain text),
 * but the menu's own search box has to stay tappable.
 */
export function holdTextFocusOutsideInputs(event) {
  if (event.target instanceof Element && event.target.closest('input, textarea')) return;
  holdTextFocus(event);
}

/** The text field that has focus right now, or null. Call when a menu opens. */
export function captureTextFocus() {
  return isTextFieldFocused() ? document.activeElement : null;
}

/**
 * Hands focus back to `field` once a menu has closed, but only if nothing else
 * took it and the field is still on the page. A menu with its own search box
 * moves focus into it; when the menu unmounts that focus would fall to <body>
 * and the keyboard would drop, so it goes back to where the person was typing.
 */
export function restoreTextFocus(field) {
  if (!field || !field.isConnected) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return;
  field.focus({ preventScroll: true });
}

/**
 * Whether a menu's own search box should take focus as the menu opens.
 *
 * With a keyboard already up it is free (focus moves from one field to another
 * and the keyboard stays). With none, focusing it would raise the keyboard
 * while the menu opens, and the menu, placed above the screen's full height,
 * would then have to move for the keyboard that arrives under it. On a touch
 * device the search box therefore waits to be tapped; a pointer-and-keyboard
 * device has no on-screen keyboard to disturb and still gets it at once.
 */
export function shouldAutoFocusSearch() {
  if (isTextFieldFocused()) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Opening a menu with the keyboard up: close the keyboard first, then open.
 *
 * Keeping the keyboard up (the approach above) was the wrong trade: a menu
 * opened over a raised keyboard sat in the squeezed space, and the person
 * still has to dismiss it to see the whole page. This does the other thing.
 * A focused text field is blurred, and `run` (which measures the trigger and
 * shows the menu) waits until the keyboard has gone and the page has settled
 * back into its full-height layout. The menu is therefore placed once, against
 * the geometry it will keep, instead of opening against the keyboard-up
 * layout and jumping when the keyboard leaves.
 *
 * With no keyboard up (desktop, or a field with a hardware keyboard) `run`
 * happens at once. Returns a cancel function for an unmount or a second tap.
 */
const KEYBOARD_CLOSE_WAIT_MS = 450;

export function dismissKeyboardThen(run) {
  if (typeof document === 'undefined') {
    run();
    return () => {};
  }
  if (isTextFieldFocused()) document.activeElement.blur();
  if (!document.documentElement.hasAttribute('data-keyboard-open')) {
    run();
    return () => {};
  }

  let finished = false;
  let timer = 0;
  let frame = 0;
  const stop = () => {
    finished = true;
    window.removeEventListener('meetifyy:keyboard-hidden', go);
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  };
  function go() {
    if (finished) return;
    window.removeEventListener('meetifyy:keyboard-hidden', go);
    clearTimeout(timer);
    finished = true;
    // Two frames: the page's own reaction to the keyboard leaving (auth
    // screens give back the room they made) has been applied and laid out.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(run);
    });
  }
  window.addEventListener('meetifyy:keyboard-hidden', go);
  // A keyboard that never reports leaving must not leave the menu unopened.
  timer = setTimeout(go, KEYBOARD_CLOSE_WAIT_MS);
  return stop;
}
