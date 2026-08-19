import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Query-param-backed component state.
 *
 * Anything that changes what the user is looking at — the selected tab, an open
 * sub-view, a filter — belongs in the URL, not in `useState`. State kept only in
 * memory disappears on reload, cannot be linked to, and gives the Back button
 * nothing to return to, which is why sub-views used to vanish on refresh and
 * why Back jumped out of a module instead of stepping back inside it.
 *
 * @param {string} key             Query parameter name.
 * @param {string} defaultValue    Value used when the param is absent. It is
 *                                 never written to the URL, so the default view
 *                                 keeps a clean address.
 * @param {object} [options]
 * @param {string[]} [options.allowed]  Whitelist; an unrecognised value in the
 *                                 URL falls back to the default instead of
 *                                 rendering an empty view.
 * @param {boolean} [options.push] When true a change pushes a history entry, so
 *                                 Back returns to the previous value. Use it for
 *                                 real sub-views (tabs, panels, overlays) and
 *                                 leave it off for incidental filters.
 * @returns {[string, (next: string|null) => void]}
 */
export function useUrlState(key, defaultValue = '', options = {}) {
  const { allowed = null, push = false } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get(key);
  const value = raw !== null && (!allowed || allowed.includes(raw)) ? raw : defaultValue;

  const setValue = useCallback(
    (next) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === null || next === undefined || next === '' || next === defaultValue) {
            params.delete(key);
          } else {
            params.set(key, next);
          }
          return params;
        },
        // preventScrollReset: switching a tab is not a page change, so the
        // scroll position stays where the user left it.
        { replace: !push, preventScrollReset: true }
      );
    },
    [key, defaultValue, push, setSearchParams]
  );

  return [value, setValue];
}

export default useUrlState;
