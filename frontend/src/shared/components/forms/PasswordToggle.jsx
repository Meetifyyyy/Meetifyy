import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from '@shared/components/icons';
import s from './PasswordToggle.module.css';

/**
 * The one show/hide password control in the app.
 *
 * There were two implementations before this — one in the auth kit, one in
 * Settings — which had drifted apart in three ways that users could feel:
 * Settings forcibly re-focused the input on toggle while auth deliberately did
 * not, Settings reached for the input with `document.getElementById` rather
 * than a ref, and each had written its own (ineffective) guard against the
 * global button press-scale. Both now use this.
 *
 * The positioning rules live in PasswordToggle.module.css; the note there
 * explains why the vertical centring must not be a `transform`.
 */

/**
 * Owns visibility for one password input, and keeps the caret where the user
 * left it across the type swap.
 *
 * Changing an input's `type` makes the browser reset the selection to the
 * start, and React re-applying a controlled `value` right after the swap resets
 * it a second time — so the caret is restored twice: once synchronously after
 * the commit, once after the value has been re-applied.
 *
 * @param {object} [options]
 * @param {boolean} [options.refocus=false] Return focus to the input after
 *   toggling. Off by default: the toggle already avoids stealing focus, so
 *   forcing it back would pop the soft keyboard on mobile for someone who only
 *   wanted to read what they had typed.
 */
export function usePasswordVisibility({ refocus = false } = {}) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef(null);
  const selectionRef = useRef(null);

  useLayoutEffect(() => {
    const el = inputRef.current;
    const selection = selectionRef.current;
    if (!el || !selection) return undefined;

    const restore = () => {
      if (refocus && document.activeElement !== el) el.focus({ preventScroll: true });
      if (document.activeElement !== el) return;
      try {
        el.setSelectionRange(selection.start, selection.end);
      } catch {
        // Some input types reject setSelectionRange; the caret is cosmetic.
      }
    };

    restore();
    const timer = window.setTimeout(restore, 0);
    return () => window.clearTimeout(timer);
    // `refocus` is read through the closure and never changes for a given field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /**
   * Force the value back to hidden.
   *
   * For the caller that has to un-reveal a password without a user gesture —
   * leaving the Change Password panel, for instance, where a revealed password
   * must not still be on screen when the panel is reopened.
   */
  const hide = useCallback(() => setVisible(false), []);

  const toggle = useCallback(() => {
    const el = inputRef.current;
    selectionRef.current = el
      ? { start: el.selectionStart, end: el.selectionEnd }
      : null;
    // Functional update, so a burst of rapid clicks can never read a stale
    // value and land on the wrong state.
    setVisible((v) => !v);
  }, []);

  return {
    visible,
    /** Feed straight to the input's `type`. */
    inputType: visible ? 'text' : 'password',
    /** Attach to the input element. */
    inputRef,
    /** Re-hide without a user gesture. */
    hide,
    /** Spread onto <PasswordToggle />. */
    toggleProps: { visible, onToggle: toggle },
  };
}

/**
 * The button itself.
 *
 * `onMouseDown` is prevented so pressing it never blurs the input — that blur
 * is what would otherwise fire validation mid-typing and make an error message
 * appear at the moment the user asked to see their password.
 */
const PasswordToggle = forwardRef(function PasswordToggle(
  { visible, onToggle, className = '', disabled = false, label, ...rest },
  ref,
) {
  const accessibleLabel = label || (visible ? 'Hide password' : 'Show password');

  return (
    <button
      ref={ref}
      type="button"
      // Not a tab stop: the field itself is the control, and a toggle between
      // the input and the submit button is a stop most people tab straight
      // past. It stays reachable by pointer and is exposed to assistive tech.
      tabIndex={-1}
      disabled={disabled}
      className={`${s.toggle} ${className}`.trim()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      aria-label={accessibleLabel}
      aria-pressed={visible}
      title={accessibleLabel}
      {...rest}
    >
      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
});

export default PasswordToggle;
