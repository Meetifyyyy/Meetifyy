import { useState, useEffect } from 'react';

/**
 * A custom hook that debounces a value.
 * @param {any} value - The value to debounce.
 * @param {number} delay - The delay in milliseconds (default 200ms).
 * @returns {any} The debounced value.
 */
export function useDebounce(value, delay = 200) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
