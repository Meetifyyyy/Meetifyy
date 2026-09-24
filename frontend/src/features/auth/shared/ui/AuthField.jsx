import { forwardRef } from 'react';
import { AlertCircle, Check, X, Loader2 } from '@shared/components/icons';
import s from './authKit.module.css';

/**
 * The one text field used across every auth flow: a static label above the
 * input (never overlaps what the user types), a real placeholder, focus ring,
 * async availability status, inline validation error, and an optional hint —
 * all visually consistent.
 *
 * Props:
 *   label, id, value, onChange, type, ...inputProps
 *   status?    see below (async availability, from useAvailabilityCheck)
 *   error?     node     — validation error (drives invalid styling + message)
 *   hint?      string   — shown under the field when there's no error
 *   endAdornment? node  — custom right-side control (e.g. a password toggle)
 *   hideLabel?  bool     — label for screen readers only (placeholder shows it)
 *
 * ## Status vocabulary
 *
 * Mirrors `useAvailabilityCheck`. Every value other than 'checking' and
 * 'available' marks the field invalid, because every one of them means the
 * value cannot be used. The previous 'network' state rendered a muted,
 * non-invalid icon, which read as "just so you know" next to a message telling
 * the user they could continue anyway; a check that did not complete is not a
 * check that passed.
 *
 *   'checking'   in flight
 *   'available'  confirmed usable
 *   'rejected'   server said no (taken, or domain not allowed)
 *   'invalid'    server refused the value as malformed
 *   'error'      the check could not be completed
 */
const StatusIcon = ({ status }) => {
  switch (status) {
    case 'checking':
      return <Loader2 size={16} className={`${s.statusIcon} ${s.spinIcon}`} />;
    case 'available':
      return <Check size={16} className={`${s.statusIcon} ${s.okIcon}`} />;
    case 'rejected':
    case 'invalid':
      return <X size={16} className={`${s.statusIcon} ${s.badIcon}`} />;
    case 'error':
      // Still an X, not a muted wifi glyph: the field is unusable, and the
      // cause being technical does not make it less so.
      return <X size={16} className={`${s.statusIcon} ${s.badIcon}`} />;
    default:
      return null;
  }
};

const BLOCKING_STATUSES = new Set(['rejected', 'invalid', 'error']);

const AuthField = forwardRef(function AuthField(
  { label, id, status, error, hint, endAdornment, hideLabel = false, className = '', ...inputProps },
  ref,
) {
  const isInvalid = !!error || BLOCKING_STATUSES.has(status);
  // The message slot is always in the DOM (it reserves the line), so the input
  // can point at it permanently; an empty slot announces nothing.
  const messageId = id ? `${id}-message` : undefined;
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
      {/* hideLabel: visually hidden, still the input's accessible name. The
          placeholder repeats the label, so the field stays self-describing. */}
      <label htmlFor={id} className={hideLabel ? s.srOnly : s.fieldLabel}>
        {label}
      </label>
      <div className={s.fieldInner}>
        <input
          ref={ref}
          id={id}
          className={inputClass}
          placeholder={label}
          aria-invalid={isInvalid || undefined}
          aria-describedby={messageId}
          {...inputProps}
        />
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

      <div className={s.messageSlot} id={messageId} aria-live="polite">
        {error ? (
          <div className={`${s.message} ${s.messageError}`}>
            <AlertCircle size={14} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : hint ? (
          <div className={`${s.message} ${s.messageHint}`}>{hint}</div>
        ) : null}
      </div>
    </div>
  );
});

export default AuthField;
