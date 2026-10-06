/**
 * What may leave the browser or the app in a Sentry event. Pure: no SDK import,
 * so it is shared by the web and Capacitor setups and unit-tested directly.
 *
 * Stricter than the API's equivalent (backend/src/observability/sentry-scrub.ts)
 * because the client sees user input the server never logs: search terms in
 * query strings, typed text, and whatever the app happens to console.log.
 *
 *  - URLs keep their path and parameter NAMES; every query VALUE is dropped.
 *    `/api/search?q=…` says which feature failed without saying what was typed.
 *  - Keys that look like credentials or personal data are redacted anywhere.
 *  - Request cookies, bodies and credential headers are removed.
 *  - The user is reduced to the internal id.
 *  - Console breadcrumbs are dropped: logs can carry message or post content.
 */

export const FILTERED = '[Filtered]';

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authori[sz]ation|cookie|session|csrf|xsrf|api[-_]?key|otp|verification[-_]?code|refresh|bearer|signature|credential|private[-_]?key|email|phone|^body$|^text$|^content$|^message_?text$/i;

export function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(String(key));
}

/** Path and parameter names only: every query value becomes [Filtered]. */
export function scrubUrl(value) {
  if (typeof value !== 'string' || !value.includes('?')) return value;
  const [beforeHash, hash = ''] = value.split('#');
  const q = beforeHash.indexOf('?');
  const base = beforeHash.slice(0, q);
  const params = beforeHash
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => `${pair.split('=')[0]}=${encodeURIComponent(FILTERED)}`);
  return `${base}${params.length ? `?${params.join('&')}` : ''}${hash ? '#' : ''}`;
}

export function scrubValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && /^(https?:\/\/|\/)[^\s]*\?/.test(value) ? scrubUrl(value) : value;
  }
  if (depth > 8 || seen.has(value)) return '[…]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1, seen));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? FILTERED : scrubValue(v, depth + 1, seen);
  }
  return out;
}

function scrubHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [name, v] of Object.entries(headers)) {
    if (!isSensitiveKey(name)) out[name] = v;
  }
  return out;
}

/** For errors and transactions alike. Mutates and returns the event. */
export function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.request) {
    const request = event.request;
    delete request.cookies;
    delete request.data;
    request.headers = scrubHeaders(request.headers);
    if (request.url) request.url = scrubUrl(request.url);
    if (request.query_string) request.query_string = undefined;
  }

  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  if (event.extra) event.extra = scrubValue(event.extra);
  if (event.contexts) event.contexts = scrubValue(event.contexts);
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean);
  }
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      if (span.data) span.data = scrubValue(span.data);
      if (span.description) span.description = scrubUrl(span.description);
    }
  }
  if (typeof event.transaction === 'string') event.transaction = scrubUrl(event.transaction);
  return event;
}

/** `beforeBreadcrumb`: null drops the crumb. */
export function scrubBreadcrumb(crumb) {
  if (!crumb) return crumb;
  if (crumb.category === 'console') return null;
  const out = { ...crumb };
  if (out.data) out.data = scrubValue(out.data);
  // Navigation crumbs carry from/to; fetch/xhr carry url.
  if (out.data?.from) out.data.from = scrubUrl(out.data.from);
  if (out.data?.to) out.data.to = scrubUrl(out.data.to);
  if (out.data?.url) out.data.url = scrubUrl(out.data.url);
  if (typeof out.message === 'string') out.message = scrubUrl(out.message);
  return out;
}

/** The feature an event belongs to, from the route: /messages/abc → "messages". */
export function featureFromPath(pathname) {
  const first = String(pathname || '').split('?')[0].split('/').filter(Boolean)[0];
  return first || 'home';
}
