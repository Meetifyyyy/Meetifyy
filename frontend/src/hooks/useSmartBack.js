import { useEffect } from 'react';
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom';

const SESSION_KEY = 'smartHistoryStack';

// Initialize from sessionStorage if available
let initialStack = [];
try {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    initialStack = JSON.parse(stored);
  }
} catch (e) {
  // Ignore
}

// Maintain a custom history stack in memory to strictly enforce linear navigation.
export let smartHistoryStack = initialStack;

const saveStack = () => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(smartHistoryStack));
  } catch (e) {
    // Ignore
  }
};

/**
 * A tracker component that must be mounted near the top of the router tree.
 * It listens to all location changes and ensures the history stack is perfectly
 * predictable by automatically truncating any discarded forward history.
 */
export function SmartBackTracker() {
  const location = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    const currentUrl = location.pathname + location.search;
    const idx = window.history.state?.idx;

    if (typeof idx === 'number') {
      // Truncate discarded forward history and set the current URL at the correct index.
      // This guarantees that "stale" forward entries are wiped out as soon as a new navigation occurs.
      smartHistoryStack = smartHistoryStack.slice(0, idx);
      smartHistoryStack[idx] = currentUrl;
      saveStack();
    } else {
      // Fallback behavior if React Router's internal index is unavailable.
      if (navType === 'PUSH') {
        smartHistoryStack.push(currentUrl);
        saveStack();
      } else if (navType === 'POP') {
        smartHistoryStack.pop();
        saveStack();
      } else if (navType === 'REPLACE') {
        if (smartHistoryStack.length > 0) {
          smartHistoryStack[smartHistoryStack.length - 1] = currentUrl;
        } else {
          smartHistoryStack.push(currentUrl);
        }
        saveStack();
      }
    }
  }, [location, navType]);

  return null;
}

/**
 * Custom hook to trigger smart back navigation.
 */
export function useSmartBack() {
  const navigate = useNavigate();

  const goBack = (fallbackPath = '/home', options = { replace: true }) => {
    const idx = window.history.state?.idx;

    // We verify if we have a valid previous entry in our strict custom stack.
    if (typeof idx === 'number' && idx > 0 && smartHistoryStack[idx - 1]) {
      // The browser's back navigation will decrement the index safely.
      navigate(-1);
    } else if (smartHistoryStack.length > 1) {
      // Fallback if idx is broken but our custom stack has history
      const previousUrl = smartHistoryStack[smartHistoryStack.length - 2];
      smartHistoryStack.pop();
      saveStack();
      navigate(previousUrl, { replace: true });
    } else {
      navigate(fallbackPath, options);
    }
  };

  return goBack;
}
