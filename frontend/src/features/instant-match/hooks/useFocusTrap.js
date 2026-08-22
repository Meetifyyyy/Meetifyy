import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keeps keyboard focus inside an open overlay and restores it on close.
 *
 * Both Instant Match surfaces are modal — the sheet takes over the screen and
 * the match popup demands an answer — so tabbing must not wander into the page
 * behind them, and dismissing must return the user to whatever they were on.
 *
 * @param {React.RefObject} containerRef the overlay element
 * @param {boolean} active               whether the overlay is open
 * @param {Function} [onEscape]          called on Escape; omit to disable
 */
export function useFocusTrap(containerRef, active, onEscape) {
  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const previouslyFocused = document.activeElement;

    const focusables = () =>
      Array.from(container.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Move focus in on open, without scroll-jumping the page.
    const first = focusables()[0];
    (first || container).focus?.({ preventScroll: true });

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && onEscape) {
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];

      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus?.({ preventScroll: true });
      }
    };
  }, [containerRef, active, onEscape]);
}
