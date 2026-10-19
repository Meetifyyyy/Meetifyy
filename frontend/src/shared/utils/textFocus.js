import { isTextFieldFocused } from '@shared/hooks/useKeyboardInset';

export { isTextFieldFocused };

/**
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
