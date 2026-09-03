import { useEffect, useRef } from 'react';

/**
 * Keeps a controlled input's React state in step with a value the browser or a
 * password manager wrote directly into the DOM.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 *
 * A controlled React input trusts `onChange` to be the only way its value
 * moves. Two very common paths do not go through it:
 *
 *   1. Chrome and Safari restoring a saved credential on page load. The value
 *      appears in the field and NO event is dispatched at all.
 *   2. A password manager extension (1Password, Bitwarden, LastPass) assigning
 *      `input.value` directly. React overrides the `value` setter on the input
 *      prototype to track changes, and an assignment made this way does not
 *      produce the React-tracked change either.
 *
 * The field then visibly contains a password while React state holds an empty
 * string. Everything downstream reads the empty string: "Password is required"
 * appears under a filled box, the confirmation comparison fails against nothing,
 * and the submit button stays disabled. From the user's side the form is simply
 * broken, and only for the people using a password manager properly.
 *
 * The login form had already hit this and worked around it by reading
 * `ref.current.value` at submit time. That unblocks submission but leaves
 * validation, the match check and the error text all reading the stale empty
 * value, and it had to be repeated at every call site. This fixes the state
 * instead, once, so every consumer sees the real value.
 *
 * ── How it detects a fill ─────────────────────────────────────────────────
 *
 * `animationstart` is the reliable signal. `input:-webkit-autofill` is a real
 * pseudo-class in Chrome and Safari, so attaching an animation to it makes the
 * browser fire an event at the moment it fills the field. Firefox does not
 * implement it, and extensions do not trigger it at all, so a short poll over
 * the first second after mount covers those; both converge on the same
 * reconcile, which is a no-op when the values already agree.
 *
 * @param {object} inputRef   ref to the input element
 * @param {string} value      the controlled value React currently believes
 * @param {Function} onChange the caller's change handler
 */
export function useAutofilledValue(inputRef, value, onChange) {
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof onChangeRef.current !== 'function') return undefined;

    /**
     * Hand the caller the real element as `event.target`, so a handler written
     * as `(e) => setPassword(e.target.value)` reads the live DOM value and
     * needs no knowledge of any of this.
     */
    const reconcile = () => {
      const el2 = inputRef.current;
      if (!el2) return;
      if (el2.value === valueRef.current) return;
      onChangeRef.current({ target: el2, currentTarget: el2 });
    };

    const onAnimationStart = (e) => {
      // Both directions matter: the fill itself, and the browser clearing it
      // again when the user backs out of the suggestion.
      if (e.animationName === 'onAutoFillStart' || e.animationName === 'onAutoFillCancel') {
        reconcile();
      }
    };

    el.addEventListener('animationstart', onAnimationStart);
    // Extensions often dispatch one of these even when React does not see the
    // value change; reconciling on them is free when nothing has moved.
    el.addEventListener('change', reconcile);
    el.addEventListener('blur', reconcile);

    // Covers Firefox and any extension that writes the value silently. Bounded
    // deliberately: this is for the fill that happens as the form appears, not
    // a permanent watcher.
    let elapsed = 0;
    const interval = window.setInterval(() => {
      elapsed += 120;
      reconcile();
      if (elapsed >= 1200) window.clearInterval(interval);
    }, 120);

    reconcile();

    return () => {
      window.clearInterval(interval);
      el.removeEventListener('animationstart', onAnimationStart);
      el.removeEventListener('change', reconcile);
      el.removeEventListener('blur', reconcile);
    };
    // Bound to the element only: the handler and value are read through refs so
    // this never re-attaches while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
