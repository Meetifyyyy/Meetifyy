import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * A hook that simulates asynchronous data fetching for our mock data.
 * It enforces the Loading -> Success/Empty -> Error pattern.
 *
 * KEY BEHAVIOR: If the data is already available (non-null/non-empty)
 * on mount, the loading delay is skipped entirely to prevent
 * unnecessary skeleton flashing on already-loaded content.
 *
 * @param {any} data - The actual synchronous data to wrap.
 * @param {number} delay - How long to delay the response (ms).
 * @param {Array} deps - Dependencies that trigger a re-fetch (e.g. ID changing).
 */
export function useSimulatedFetch(data, delay = 800, deps = []) {
  const hasLoadedOnce = useRef(false);

  // Determine if data is meaningfully present right now
  const dataIsReady = data != null && (
    !Array.isArray(data) || data.length > 0
  );

  // If data is already available, skip the loading phase entirely
  const shouldSkipLoading = dataIsReady || hasLoadedOnce.current;

  const [isLoading, setIsLoading] = useState(!shouldSkipLoading);
  const [error, setError] = useState(null);

  const fetchSim = useCallback(() => {
    // If we already have data or have loaded before, no delay needed
    if (shouldSkipLoading) {
      hasLoadedOnce.current = true;
      setIsLoading(false);
      setError(null);
      return () => {};
    }

    setIsLoading(true);
    setError(null);
    
    const timer = setTimeout(() => {
      hasLoadedOnce.current = true;
      setIsLoading(false);
      setError(null);
    }, delay);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, shouldSkipLoading, ...deps]);

  useEffect(() => {
    const cleanup = fetchSim();
    return cleanup;
  }, [fetchSim]);

  // If data becomes available while we're "loading", stop immediately
  useEffect(() => {
    if (isLoading && dataIsReady) {
      hasLoadedOnce.current = true;
      setIsLoading(false);
    }
  }, [isLoading, dataIsReady]);

  const retry = () => {
    hasLoadedOnce.current = false;
    setIsLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      hasLoadedOnce.current = true;
      setIsLoading(false);
      setError(null);
    }, delay);
    return () => clearTimeout(timer);
  };

  return { 
    isLoading, 
    data: isLoading ? null : data, 
    error, 
    retry 
  };
}
