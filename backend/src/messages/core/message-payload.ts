/**
 * Reading a message's `payload` JSON column.
 *
 * Prisma types it as JsonValue: it may be an object, an array, a string, a
 * number or null, and nothing guarantees its fields. The send path writes an
 * object with string media fields, so these readers answer with exactly those
 * types and treat anything else as absent.
 */

/** The fields of a JSON value, or none: a non-object has nothing to read. */
export function payloadFields(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** A non-empty string, or null. */
export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** A string, or '' for anything else. */
export function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** An array, or [] for anything else. */
export function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
