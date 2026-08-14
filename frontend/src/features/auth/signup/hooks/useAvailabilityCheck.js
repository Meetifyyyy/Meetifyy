import { useState, useEffect, useRef } from 'react';
import { apiClient } from '@shared/api/apiClient';

/**
 * Debounced availability check for signup fields (username / email).
 *
 * Speed & UX:
 *  - Per-hook in-memory cache: a value that was already resolved returns its
 *    status instantly on re-type (e.g. after editing then reverting), with zero
 *    network calls.
 *  - AbortController: when the value changes mid-flight, the previous request is
 *    cancelled so only the latest value's result is applied — no stale flicker.
 *  - Short debounce so it feels responsive but still coalesces keystrokes.
 *
 * status: null | 'checking' | 'available' | 'taken' | 'network-error'
 *
 * @param {string} value      Already-normalized value to check (e.g. lowercased).
 * @param {object} opts
 * @param {string} opts.endpoint  API path, e.g. '/api/auth/check-username'.
 * @param {string} opts.field     Body field name, e.g. 'username' or 'email'.
 * @param {boolean} opts.enabled  Skip checking (e.g. while format is invalid).
 * @param {number} [opts.debounceMs=300]
 */
export function useAvailabilityCheck(value, { endpoint, field, enabled = true, debounceMs = 300 }) {
  const [status, setStatus] = useState(null);
  const [reason, setReason] = useState('');
  // value -> { available: boolean, reason: string }. Only successful lookups are cached.
  const cacheRef = useRef(new Map());

  useEffect(() => {
    if (!enabled || !value) {
      setStatus(null);
      setReason('');
      return;
    }

    const cached = cacheRef.current.get(value);
    if (cached) {
      setStatus(cached.available ? 'available' : 'taken');
      setReason(cached.reason || '');
      return;
    }

    let active = true;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setStatus('checking');
      try {
        const res = await apiClient.post(endpoint, { [field]: value }, { signal: controller.signal });
        if (!active) return;
        const available = res?.available === true;
        cacheRef.current.set(value, { available, reason: res?.reason || '' });
        setStatus(available ? 'available' : 'taken');
        setReason(res?.reason || '');
      } catch (err) {
        // Ignore aborted requests (value changed) and don't cache transient errors.
        if (!active || controller.signal.aborted) return;
        setStatus('network-error');
        setReason('');
      }
    }, debounceMs);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [value, enabled, endpoint, field, debounceMs]);

  return { status, reason, cache: cacheRef.current };
}
