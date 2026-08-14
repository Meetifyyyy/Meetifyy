import React, { forwardRef } from 'react';
import { AlertCircle, Check, X, Loader2, WifiOff } from 'lucide-react';
import s from './authKit.module.css';

/**
 * The one text field used across every auth flow: a static label above the
 * input (never overlaps what the user types), a real placeholder, focus ring,
 * async availability status (checking / available / taken / network), inline
 * validation error, and an optional hint — all visually consistent.
 *
 * Props:
 *   label, id, value, onChange, type, ...inputProps
 *   status?    'checking' | 'available' | 'taken' | 'network'  (async availability)
 *   error?     string   — validation error (drives invalid styling + message)
 *   hint?      string   — shown under the field when there's no error
 *   endAdornment? node  — custom right-side control (e.g. a password toggle)
 */
const StatusIcon = ({ status }) => {
  switch (status) {
    case 'checking':
      return <Loader2 size={16} className={`${s.statusIcon} ${s.spinIcon}`} />;
    case 'available':
      return <Check size={16} className={`${s.statusIcon} ${s.okIcon}`} />;
    case 'taken':
      return <X size={16} className={`${s.statusIcon} ${s.badIcon}`} />;
    case 'network':
      return <WifiOff size={15} className={`${s.statusIcon} ${s.mutedIcon}`} />;
    default:
      return null;
  }
};

const AuthField = forwardRef(function AuthField(
  { label, id, status, error, hint, endAdornment, className = '', ...inputProps },
  ref,
) {
  const isInvalid = !!error || status === 'taken';
  const isValid = status === 'available';
  const hasAdornment = !!status || !!endAdornment;

  const inputClass = [
    s.input,
    hasAdornment ? s.hasAdornment : '',
    isInvalid ? s.invalid : '',
    isValid ? s.valid : '',
  ]
    .filter(Boolean)
    .join(' ');

  const fieldClass = [s.field, isInvalid ? s.isInvalid : '', isValid ? s.isValid : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={fieldClass}>
      <label htmlFor={id} className={s.fieldLabel}>
        {label}
      </label>
      <div className={s.fieldInner}>
        <input ref={ref} id={id} className={inputClass} placeholder={label} {...inputProps} />
        {endAdornment
          ? endAdornment
          : status
            ? (
              <span className={s.adornment} aria-hidden="true">
                <StatusIcon status={status} />
              </span>
            )
            : null}
      </div>

      <div className={s.messageSlot}>
        {error ? (
          <div className={`${s.message} ${s.messageError}`}>
            <AlertCircle size={13} /> {error}
          </div>
        ) : hint ? (
          <div className={`${s.message} ${s.messageHint}`}>{hint}</div>
        ) : null}
      </div>
    </div>
  );
});

export default AuthField;
