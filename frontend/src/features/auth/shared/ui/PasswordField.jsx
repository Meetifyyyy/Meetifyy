import React, { forwardRef, useLayoutEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from '@shared/components/icons';
import AuthField from './AuthField';
import s from './authKit.module.css';

/**
 * A password AuthField with a built-in show/hide toggle. Same visual language as
 * every other field; the toggle never steals focus from the input.
 *
 * Wrapped with forwardRef so callers can attach a ref directly to the underlying
 * input element (needed to read browser-autofilled values that don't fire onChange).
 */
const PasswordField = forwardRef(function PasswordField({ id, label = 'Password', ...props }, ref) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef(null);
  const caretRef = useRef(null);

  // Switching the input's `type` (password <-> text) makes the browser drop
  // the caret back to the start. Restore whatever selection was there right
  // before the toggle so the cursor stays put instead of jumping.
  useLayoutEffect(() => {
    const el = inputRef.current;
    const caret = caretRef.current;
    if (el == null || caret == null) return;
    const restore = () => {
      if (document.activeElement === el) el.setSelectionRange(caret, caret);
    };
    // React re-applies the controlled input's value right after the type
    // swap commits, which drops the caret back to 0 — restore once more
    // right after that happens.
    restore();
    const timer = setTimeout(restore, 0);
    return () => clearTimeout(timer);
  }, [visible]);

  const toggle = (
    <button
      type="button"
      tabIndex={-1}
      className={s.toggle}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        caretRef.current = inputRef.current ? inputRef.current.selectionStart : null;
        setVisible((v) => !v);
      }}
      aria-label={visible ? 'Hide password' : 'Show password'}
    >
      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );

  return (
    <AuthField
      ref={ref || inputRef}
      id={id}
      label={label}
      type={visible ? 'text' : 'password'}
      autoComplete={props.autoComplete || 'current-password'}
      endAdornment={toggle}
      {...props}
    />
  );
});

export default PasswordField;
