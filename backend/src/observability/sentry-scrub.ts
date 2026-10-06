/**
 * What may leave the server in a Sentry event, enforced on the event itself.
 *
 * `dataCollection` in instrument.ts decides what the SDK *collects*; this is
 * the second line, applied to every error and transaction just before it is
 * sent, so a new integration, a new header or a value someone attaches as
 * context cannot carry a credential out by default.
 *
 * Kept: the route, method, status, the internal user id, stack traces,
 * breadcrumbs' shape. Removed: cookies, request bodies, credential headers,
 * token-like query parameters, and every user field but the id.
 */
import type { Breadcrumb, Event } from '@sentry/nestjs';

/** Keys whose value is a credential or personal data wherever they appear. */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authori[sz]ation|cookie|session|csrf|xsrf|api[-_]?key|otp|verification[-_]?code|refresh|bearer|signature|credential|private[-_]?key|email|phone/i;

/** Query parameters dropped from any URL that is kept. */
const SENSITIVE_PARAM =
  /token|code|otp|secret|key|signature|sig|password|email|phone|state/i;

export const REDACTED = '[Filtered]';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** A URL with token-like query parameters removed; anything unparseable is cut at `?`. */
export function scrubUrl(value: string): string {
  if (!value || !value.includes('?')) return value;
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
    const parsed = new URL(value, 'http://relative.invalid');
    for (const name of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(name)) parsed.searchParams.set(name, REDACTED);
    }
    const out = absolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return out;
  } catch {
    return value.split('?')[0];
  }
}

/** Recursively replaces the values of sensitive keys. Depth-limited, cycle-safe. */
export function scrubValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && /^https?:\/\//i.test(value)
      ? scrubUrl(value)
      : value;
  }
  if (depth > 8 || seen.has(value)) return '[…]';
  seen.add(value);
  if (Array.isArray(value))
    return value.map((v) => scrubValue(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : scrubValue(v, depth + 1, seen);
  }
  return out;
}

function scrubHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [name, v] of Object.entries(headers)) {
    if (isSensitiveKey(name)) continue; // dropped, not just masked
    out[name] = v;
  }
  return out;
}

/** Applied to errors and transactions alike. Mutates and returns the event. */
export function scrubEvent<T extends Event>(event: T): T {
  if (event.request) {
    const request = event.request;
    delete request.cookies;
    delete request.data; // bodies: a login body is a password, a message body is private
    request.headers = scrubHeaders(request.headers);
    if (request.url) request.url = scrubUrl(request.url);
    if (typeof request.query_string === 'string') {
      request.query_string = scrubUrl(`?${request.query_string}`).slice(1);
    } else if (request.query_string) {
      request.query_string = scrubValue(
        request.query_string,
      ) as typeof request.query_string;
    }
  }

  // Only the internal id. No email, username or IP address.
  if (event.user) {
    event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  }

  if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra;
  if (event.contexts)
    event.contexts = scrubValue(event.contexts) as typeof event.contexts;

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb: Breadcrumb) => ({
      ...crumb,
      data: crumb.data
        ? (scrubValue(crumb.data) as typeof crumb.data)
        : crumb.data,
    }));
  }

  if (event.spans) {
    for (const span of event.spans) {
      if (span.data) span.data = scrubValue(span.data) as typeof span.data;
      if (span.description) span.description = scrubUrl(span.description);
    }
  }

  return event;
}
