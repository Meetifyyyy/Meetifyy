import { config } from '../../config';

/**
 * The boundary between "what happened" and "what was in it".
 *
 * Monitoring records shapes, not contents: a route, a status, a duration. This
 * module exists so that rule is enforced in one auditable place rather than
 * relied on at each call site.
 *
 * The denylist is configurable through REDACT_FIELDS, but only additively -
 * `monitoring.config.ts` merges it on top of a hardcoded minimum so no
 * deployment can widen what is captured by setting a variable. Adding a newly
 * sensitive field later is a config change; removing a protection is not
 * possible without editing code, which is the correct asymmetry.
 */

const REDACTED = '[redacted]';

/** Values that look like a credential wherever they appear in a string. */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer tokens and JWTs.
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
    replacement: `Bearer ${REDACTED}`,
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,
    replacement: REDACTED,
  },
  // Provider key prefixes.
  {
    pattern: /\b(sk|pk|rk|re)_(live|test)_[A-Za-z0-9]{8,}\b/g,
    replacement: REDACTED,
  },
  // Connection strings carrying credentials.
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^:\s/@]+:[^@\s]+@/gi,
    replacement: `$1${REDACTED}@`,
  },
  // key=value / key: value pairs whose key names a secret.
  {
    pattern:
      /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|otp|cookie)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
    replacement: `$1=${REDACTED}`,
  },
  // Bare email addresses. `userId` is the only identifier these tables carry,
  // so an address reaching an error message is a leak even though it is not a
  // credential.
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: REDACTED,
  },
];

/** True when a key names something that must never be stored. */
export function isRedactedField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return config.monitoring.redactFields.some(
    (field) => normalized === field.replace(/[-_\s]/g, ''),
  );
}

/**
 * Strips credential-shaped substrings from free text.
 *
 * Applied to every error message before storage. An error thrown by a driver
 * or a third-party library can quote the input that caused it, and that input
 * is exactly what must not be persisted.
 */
export function redactText(
  input: string | null | undefined,
  maxLength = 2000,
): string {
  if (!input) return '';
  let text = String(input);
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text.slice(0, maxLength);
}

/**
 * Recursively redacts an object for display.
 *
 * Not used on the request path - no request or response body is ever recorded -
 * but available for structured context an admin action might attach later, so
 * that such a feature cannot be built without passing through this function.
 */
export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 4) return REDACTED;
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactText(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value))
    return value.slice(0, 20).map((entry) => redactObject(entry, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = isRedactedField(key)
        ? REDACTED
        : redactObject(entry, depth + 1);
    }
    return out;
  }

  return REDACTED;
}

/**
 * Reduces a concrete URL path to a route pattern.
 *
 * Used only when the framework could not supply the matched route. Without
 * this, `/api/messages/8231` and `/api/messages/8232` are two different rows
 * and per-endpoint aggregation is meaningless. The identifier segments are
 * also the ones most likely to be sensitive, so collapsing them is a privacy
 * measure as much as a grouping one.
 */
export function normalizeRoutePath(path: string): string {
  const [withoutQuery] = String(path || '/').split('?');

  return (
    withoutQuery
      .split('/')
      .map((segment) => {
        if (!segment) return segment;
        if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            segment,
          )
        )
          return ':id';
        if (/^\d+$/.test(segment)) return ':id';
        // Long opaque strings are object keys, public ids and hashes.
        if (/^[0-9a-f]{24,}$/i.test(segment)) return ':id';
        if (segment.length > 24 && !segment.includes('.')) return ':id';
        return segment;
      })
      .join('/')
      .slice(0, 300) || '/'
  );
}
