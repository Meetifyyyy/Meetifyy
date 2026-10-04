import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

function tabbablesIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.closest('[inert], [aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden',
  );
}

/**
 * Focus behaviour for a modal dialog that is not the media viewer.
 *
 * - moves focus into the dialog when it opens (the first control, or the element
 *   named by `initialFocus`, falling back to the dialog itself);
 * - keeps Tab and Shift+Tab inside it, and pulls focus back if something outside
 *   takes it;
 * - Escape calls `onEscape` and stops there, so a sheet opened over the media
 *   viewer or the Instant Match chat closes alone instead of dismissing the
 *   layer underneath as well;
 * - puts focus back on whatever had it before the dialog opened.
 *
 * The dialog element needs `tabIndex={-1}`. This deliberately leaves the
 * background alone: when a media viewer is open it already makes everything that
 * is not its own layer inert, and a dialog that is a later portal is treated as
 * one of its own layers. Where there is no viewer, `aria-modal` conveys the rest.
 *
 * @param {React.RefObject<HTMLElement>} dialogRef
 * @param {object}  options
 * @param {boolean} [options.active=true]
 * @param {() => void} [options.onEscape]
 * @param {() => (HTMLElement|null|undefined)} [options.getInitialFocus]
 */
export function useDialogFocus(dialogRef, { active = true, onEscape, getInitialFocus } = {}) {
  const onEscapeRef = useRef(onEscape);
  const initialFocusRef = useRef(getInitialFocus);
  useEffect(() => {
    onEscapeRef.current = onEscape;
    initialFocusRef.current = getInitialFocus;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!active || !dialog) return undefined;

    const opener = document.activeElement;
    const initial = initialFocusRef.current?.() || tabbablesIn(dialog)[0] || dialog;
    initial.focus({ preventScroll: true });

    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        // Stopped here on purpose: see the note above about layers underneath.
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const elements = tabbablesIn(dialog);
      if (elements.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const current = elements.indexOf(document.activeElement);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (e.shiftKey && (current <= 0)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === -1 || current === elements.length - 1)) {
        e.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (e) => {
      if (dialog.contains(e.target)) return;
      // A later layer (a sheet or menu opened from this dialog) may legitimately
      // take focus; only reclaim it when nothing newer owns it.
      const newer = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="menu"]')]
        .some((el) => el !== dialog && el.contains(e.target));
      if (newer) return;
      (tabbablesIn(dialog)[0] || dialog).focus({ preventScroll: true });
    };

    dialog.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest('[inert]')) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [active, dialogRef]);
}
