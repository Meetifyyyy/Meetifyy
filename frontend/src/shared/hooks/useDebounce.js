import { useState, useEffect, useRef, useCallback } from 'react';

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

/**
 * State hook providing an immediate value, a debounced value, and an update function
 * that allows immediate updates (e.g. for clearing) and timer cancellation.
 */
export function useDebouncedState(initialValue = '', delay = 200) {
  const [value, setValue] = useState(initialValue);
  const [debouncedValue, setDebouncedValue] = useState(initialValue);
  const timerRef = useRef(null);

  const updateValue = useCallback((newValue, immediate = false) => {
    setValue(newValue);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (immediate) {
      setDebouncedValue(newValue);
    } else {
      timerRef.current = setTimeout(() => {
        setDebouncedValue(newValue);
      }, delay);
    }
  }, [delay]);

  const cancelDebounce = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetValue = useCallback((newValue = '') => {
    updateValue(newValue, true);
  }, [updateValue]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    value,
    debouncedValue,
    setValue: updateValue,
    resetValue,
    cancelDebounce,
    setImmediateValue: (val) => updateValue(val, true),
  };
}

