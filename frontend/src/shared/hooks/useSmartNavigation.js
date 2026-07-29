import { useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { overlayManager } from '@shared/services/OverlayManager';

const SESSION_KEY = 'smartHistoryStack_v2';

const _state = {
  stack: [], // Array of path strings e.g. ['/home', '/crew', '/messages']
};

try {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) _state.stack = parsed;
  }
} catch (e) {
  /* ignore */
}

function saveStack() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(_state.stack));
  } catch (e) {
    /* ignore */
  }
}

/**
 * Extracts base meaningful path without transient search parameters
 * unless search is a distinct search route (/search?q=...).
 */
export function getMeaningfulPath(pathname, search = '') {
  // If search query is non-empty on /search, keep path clean or normalized
  if (pathname === '/search') {
    return pathname;
  }
  return pathname;
}

/**
 * SmartBackTracker component — mount once at router root.
 * Synchronizes history stack with meaningful route changes, eliminating duplicate entries.
 */
export function SmartBackTracker() {
  const location = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    const currentPath = getMeaningfulPath(location.pathname, location.search);
    const idx = window.history.state?.idx;

    if (typeof idx === 'number') {
      _state.stack.splice(idx);
      _state.stack[idx] = currentPath;
    } else {
      if (navType === 'PUSH') {
        const lastEntry = _state.stack[_state.stack.length - 1];
        if (lastEntry !== currentPath) {
          _state.stack.push(currentPath);
        }
      } else if (navType === 'POP') {
        if (_state.stack.length > 1) {
          _state.stack.pop();
        }
      } else if (navType === 'REPLACE') {
        if (_state.stack.length > 0) {
          _state.stack[_state.stack.length - 1] = currentPath;
        } else {
          _state.stack.push(currentPath);
        }
      }
    }

    // Home is the navigation root — collapse all prior in-app history.
    // After this point, browser Back exits the app rather than re-entering
    // previously visited in-app pages.
    if (currentPath === '/home') {
      _state.stack = ['/home'];
    }

    saveStack();
  }, [location.pathname, location.search, navType]);

  return null;
}

export function getLastNonMessagePath() {
  for (let i = _state.stack.length - 1; i >= 0; i--) {
    const p = _state.stack[i];
    if (p && !p.startsWith('/messages') && !p.startsWith('/inbox')) {
      return p;
    }
  }
  return null;
}

/**
 * Centralized production-grade navigation hook.
 *
 * Provides:
 *  - `goBack(fallbackPath, options)`: Intelligently handles back navigation, overlay dismissal, and fallback paths.
 *  - `smartNavigate(target, options)`: Wrapper around `navigate` that replaces duplicate routes to prevent stack pollution.
 */
export function useSmartNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const isNavigating = useRef(false);

  const goBack = useCallback(
    (fallbackPath = '/home', options = { replace: true }) => {
      // 0. Home is the navigation root — never navigate further back in-app.
      //    Let the browser handle Back naturally from here (exit to external,
      //    close tab, or do nothing depending on how the user arrived).
      if (location.pathname === '/home') return;

      // 1. Check if any overlay (modal/drawer/sheet) is open and close it first
      if (overlayManager.hasOpenOverlays()) {
        overlayManager.closeTop();
        return;
      }

      // 2. Debounce double clicks
      if (isNavigating.current) return;
      isNavigating.current = true;
      setTimeout(() => {
        isNavigating.current = false;
      }, 350);

      // Check explicit state.from origin first
      if (location.state?.from && location.state.from !== location.pathname) {
        navigate(location.state.from, { replace: true });
        return;
      }

      const isMessagesRoute = location.pathname.startsWith('/messages') || location.pathname.startsWith('/inbox');
      if (isMessagesRoute) {
        const lastNonMsg = getLastNonMessagePath();
        if (lastNonMsg && lastNonMsg !== location.pathname) {
          navigate(lastNonMsg, { replace: true });
          return;
        }
        navigate(fallbackPath, { replace: true });
        return;
      }

      const idx = window.history.state?.idx;
      const currentPath = getMeaningfulPath(location.pathname);

      if (typeof idx === 'number' && idx > 0) {
        // Find previous distinct path in history
        const prevPath = _state.stack[idx - 1];
        if (prevPath && prevPath !== currentPath) {
          navigate(-1);
        } else if (_state.stack.length > 1) {
          // Find first distinct previous path
          let targetIdx = idx - 1;
          while (targetIdx >= 0 && _state.stack[targetIdx] === currentPath) {
            targetIdx--;
          }
          if (targetIdx >= 0) {
            const stepsBack = idx - targetIdx;
            navigate(-stepsBack);
          } else {
            navigate(fallbackPath, { replace: true });
          }
        } else {
          navigate(fallbackPath, { replace: true });
        }
      } else {
        // Direct URL entry, refresh, or no in-app history available
        if (_state.stack.length > 1) {
          const previousUrl = _state.stack[_state.stack.length - 2];
          _state.stack.pop();
          saveStack();
          navigate(previousUrl, { replace: true });
        } else {
          navigate(fallbackPath, options);
        }
      }
    },
    [navigate, location.pathname, location.state]
  );

  const smartNavigate = useCallback(
    (to, options = {}) => {
      const targetPath = typeof to === 'string' ? to.split('?')[0] : (to.pathname || '');
      const currentPath = location.pathname;

      // If navigating to the current path, use replace to avoid pushing duplicate entries
      const shouldReplace = options.replace || targetPath === currentPath;

      navigate(to, { ...options, replace: shouldReplace });
    },
    [navigate, location.pathname]
  );

  return {
    goBack,
    smartNavigate,
    navigate: smartNavigate,
  };
}
