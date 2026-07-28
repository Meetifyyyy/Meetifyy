import { useSmartNavigation, SmartBackTracker as CoreSmartBackTracker } from './useSmartNavigation';

export const SmartBackTracker = CoreSmartBackTracker;

/**
 * Backwards-compatible hook wrapper for useSmartBack.
 * Returns a stable `goBack(fallbackPath, options)` function.
 */
export function useSmartBack() {
  const { goBack } = useSmartNavigation();
  return goBack;
}

export default useSmartBack;
