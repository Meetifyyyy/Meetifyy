import { useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom';

const SESSION_KEY = 'smartHistoryStack';

// ── Module-level stack ──────────────────────────────────────────────────────
// Stored as an object so reassignment in SmartBackTracker stays visible to
// useSmartBack (both live in the same module, so this is safe).
const _state = { stack: [] };

try {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) _state.stack = parsed;
  }
} catch (e) { /* ignore */ }

function saveStack() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(_state.stack));
  } catch (e) { /* ignore */ }
}

/**
 * Tracker component — mount once at the router root.
 * Keeps _state.stack perfectly in sync with the browser history index so
 * useSmartBack always sees the true previous entry.
 */
export function SmartBackTracker() {
  const location = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    const currentUrl = location.pathname + location.search;
    const idx = window.history.state?.idx;

    if (typeof idx === 'number') {
      // Truncate any forward history that was discarded by a new PUSH/REPLACE,
      // then write the current URL at the correct slot.
      // Use splice-then-set to avoid sparse array holes when idx > current length.
      _state.stack.splice(idx); // remove everything from idx onward
      _state.stack[idx] = currentUrl; // set current slot
    } else {
      // Fallback: React Router didn't expose its internal idx.
      if (navType === 'PUSH') {
        _state.stack.push(currentUrl);
      } else if (navType === 'POP') {
        // POP can be back or forward; best we can do without idx is pop one entry.
        if (_state.stack.length > 1) _state.stack.pop();
      } else if (navType === 'REPLACE') {
        if (_state.stack.length > 0) {
          _state.stack[_state.stack.length - 1] = currentUrl;
        } else {
          _state.stack.push(currentUrl);
        }
      }
    }

    saveStack();
  }, [location, navType]);

  return null;
}

/**
 * Returns a stable `goBack` function.
 *
 * Priority:
 *   1. If the browser history index says there is a real previous in-app entry,
 *      use navigate(-1) — this is the canonical back action.
 *   2. If idx is unavailable but our custom stack has a previous entry, navigate
 *      to that URL directly (replaces current entry to avoid stack inflation).
 *   3. Otherwise navigate to `fallbackPath` (direct URL access, refresh, new tab).
 *
 * Double-click guard: a second call within 400 ms is ignored.
 */
export function useSmartBack() {
  const navigate = useNavigate();
  const _navigating = useRef(false);

  const goBack = useCallback((fallbackPath = '/home', options = { replace: true }) => {
    if (_navigating.current) return;
    _navigating.current = true;
    setTimeout(() => { _navigating.current = false; }, 400);

    const idx = window.history.state?.idx;

    if (typeof idx === 'number') {
      // idx > 0 means there is at least one in-app entry behind us.
      if (idx > 0 && _state.stack[idx - 1]) {
        navigate(-1);
      } else {
        // idx === 0: we are at the very first history entry — use fallback.
        navigate(fallbackPath, { replace: true });
      }
    } else {
      // idx not available — fall back to custom stack.
      if (_state.stack.length > 1) {
        const previousUrl = _state.stack[_state.stack.length - 2];
        _state.stack.pop();
        saveStack();
        navigate(previousUrl, { replace: true });
      } else {
        navigate(fallbackPath, options);
      }
    }
  }, [navigate]);

  return goBack;
}
