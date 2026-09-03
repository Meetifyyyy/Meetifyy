import { forwardRef, useCallback } from 'react';
import PasswordToggle, { usePasswordVisibility } from '@shared/components/forms/PasswordToggle';
import AuthField from './AuthField';

/**
 * A password AuthField with the app's show/hide toggle. Same visual language as
 * every other field; the toggle never steals focus from the input.
 *
 * Wrapped with forwardRef so callers can attach a ref directly to the underlying
 * input element (needed to read browser-autofilled values that don't fire onChange).
 */
const PasswordField = forwardRef(function PasswordField({ id, label = 'Password', ...props }, ref) {
  const { inputType, inputRef, toggleProps } = usePasswordVisibility();

  /**
   * Both refs, not either/or.
   *
   * This used to pass `ref || inputRef`, so the moment a caller supplied its own
   * ref — which LoginPage and the signup flow both do, to read autofilled
   * values — the internal ref was never attached. `inputRef.current` stayed
   * null, and the caret-restoring logic silently did nothing on exactly the
   * screens that matter most. Forwarding to both means the caller keeps its
   * handle and the field keeps its own.
   */
  const attachRef = useCallback((node) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref, inputRef]);

  return (
    <AuthField
      ref={attachRef}
      id={id}
      label={label}
      type={inputType}
      autoComplete={props.autoComplete || 'current-password'}
      /*
       * The toggle names its own field. Two password fields share a screen in
       * the signup flow and on the reset-password screen, and a pair of buttons
       * both announcing "Show password" gives a screen-reader user no way to
       * tell which is which.
       */
      endAdornment={(
        <PasswordToggle
          {...toggleProps}
          disabled={props.disabled}
          label={`${toggleProps.visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        />
      )}
      {...props}
    />
  );
});

export default PasswordField;
