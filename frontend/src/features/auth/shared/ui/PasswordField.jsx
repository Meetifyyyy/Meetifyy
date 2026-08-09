import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import AuthField from './AuthField';
import s from './authKit.module.css';

/**
 * A password AuthField with a built-in show/hide toggle. Same visual language as
 * every other field; the toggle never steals focus from the input.
 */
export default function PasswordField({ id, label = 'Password', ...props }) {
  const [visible, setVisible] = useState(false);

  const toggle = (
    <button
      type="button"
      tabIndex={-1}
      className={s.toggle}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setVisible((v) => !v)}
      aria-label={visible ? 'Hide password' : 'Show password'}
    >
      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );

  return (
    <AuthField
      id={id}
      label={label}
      type={visible ? 'text' : 'password'}
      autoComplete={props.autoComplete || 'current-password'}
      endAdornment={toggle}
      {...props}
    />
  );
}
