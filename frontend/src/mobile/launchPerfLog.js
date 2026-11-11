/**
 * The launch's timings, collected in one place when asked for.
 *
 * Off unless `localStorage.meetifyy_perf` is "1" (set it from the WebView
 * inspector, then cold start). The marks themselves are always recorded, they
 * cost nothing; this only gathers them, with the browser's own paint and
 * navigation entries, into `window.__meetifyyPerf.entries` so a launch can be
 * read at a glance or by scripts/measure-startup.mjs. All times are
 * milliseconds since navigation start.
 */
export const PERF_FLAG_KEY = 'meetifyy_perf';

export function launchPerfEnabled(storage = typeof window === 'undefined' ? undefined : window.localStorage) {
  try {
    return storage?.getItem(PERF_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function collectLaunchPerf(perf = performance) {
  const entries = [];
  const add = (name, at) => {
    if (Number.isFinite(at) && at > 0) entries.push({ name, at: Math.round(at) });
  };
  const nav = perf.getEntriesByType('navigation')[0];
  if (nav) {
    add('response end', nav.responseEnd);
    add('dom interactive (entry script evaluated)', nav.domInteractive);
    add('dom content loaded', nav.domContentLoadedEventEnd);
  }
  for (const paint of perf.getEntriesByType('paint')) add(paint.name, paint.startTime);
  for (const m of perf.getEntriesByType('mark')) {
    if (m.name.startsWith('meetifyy:')) add(m.name.slice('meetifyy:'.length), m.startTime);
  }
  return entries.sort((a, b) => a.at - b.at);
}

/** Records the launch log once Home has painted, when the flag is set. */
export function recordLaunchPerf({ enabled = launchPerfEnabled(), target = window } = {}) {
  if (!enabled) return null;
  const entries = collectLaunchPerf();
  target.__meetifyyPerf = { entries };
  return entries;
}
