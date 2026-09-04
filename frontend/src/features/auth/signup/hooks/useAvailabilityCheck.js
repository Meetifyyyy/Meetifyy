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
 * ## Why the statuses are separate
 *
 * This hook used to funnel every thrown error into one `'network-error'`
 * status. That conflated two unrelated things: the server saying "that input is
 * not valid" (an HTTP 400 from the validation pipe) and the request never
 * completing. The signup screens then rendered the same reassuring hint for
 * both — "couldn't verify, you can still continue" — so typing a half-finished
 * address like `student@gla.ac.` produced a 400 and an invitation to carry on.
 *
 * A caller cannot make a safe decision from a single failure status, so the
 * hook now reports which kind of failure it was:
 *
 *   null        nothing to check yet (empty, or disabled by the caller)
 *   'checking'  request in flight
 *   'available' server said yes
 *   'rejected'  server said no; `code` and `reason` say why
 *   'invalid'   server refused the input as malformed (4xx)
 *   'error'     the request did not complete, or the server failed (5xx)
 *
 * `'rejected'`, `'invalid'` and `'error'` are all blocking. None of them means
 * "probably fine, continue".
 *
 * @param {string} value      Already-normalized value to check (e.g. lowercased).
 * @param {object} opts
 * @param {string} opts.endpoint  API path, e.g. '/api/auth/check-username'.
 * @param {string} opts.field     Body field name, e.g. 'username' or 'email'.
 * @param {boolean} opts.enabled  Skip checking (e.g. while format is invalid).
 * @param {number} [opts.debounceMs=300]
 * @returns {{ status: string|null, code: string, reason: string, cache: Map }}
 */
export function useAvailabilityCheck(value, { endpoint, field, extraBody, enabled = true, debounceMs = 300 }) {
  const [status, setStatus] = useState(null);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  // cacheKey -> { status, code, reason }. Only settled answers from the server
  // are cached; a transport failure is never cached, so a retry re-requests.
  const cacheRef = useRef(new Map());

  const extraBodyStr = extraBody ? JSON.stringify(extraBody) : '';
  const cacheKey = extraBodyStr ? `${value}|${extraBodyStr}` : value;

  useEffect(() => {
    if (!enabled || !value) {
      setStatus(null);
      setReason('');
      setCode('');
      return;
    }

    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setStatus(cached.status);
      setReason(cached.reason || '');
      setCode(cached.code || '');
      return;
    }

    let active = true;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setStatus('checking');
      setReason('');
      setCode('');
      try {
        const payload = { [field]: value, ...(extraBody || {}) };
        const res = await apiClient.post(endpoint, payload, { signal: controller.signal });
        if (!active) return;
        const settled = res?.available === true
          ? { status: 'available', code: '', reason: '' }
          : { status: 'rejected', code: res?.code || '', reason: res?.reason || '' };
        cacheRef.current.set(cacheKey, settled);
        setStatus(settled.status);
        setReason(settled.reason);
        setCode(settled.code);
      } catch (err) {
        // Ignore aborted requests (the value changed under us).
        if (!active || controller.signal.aborted) return;

        // A 4xx is the server having read the input and refused it. That is an
        // answer, and it must not be presented as a connectivity problem — but
        // it is not cached, because the endpoint may be rejecting for a reason
        // that changes (rate limiting, for instance).
        const httpStatus = err?.status;
        if (httpStatus >= 400 && httpStatus < 500) {
          setStatus(httpStatus === 429 ? 'error' : 'invalid');
          setCode(err?.code || '');
          setReason(httpStatus === 429 ? '' : err?.message || '');
          return;
        }

        // Everything else — offline, DNS, timeout, 5xx — is a technical failure.
        setStatus('error');
        setCode('');
        setReason('');
      }
    }, debounceMs);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [value, cacheKey, enabled, endpoint, field, debounceMs, extraBodyStr]);

  return { status, reason, code, cache: cacheRef.current };
}
