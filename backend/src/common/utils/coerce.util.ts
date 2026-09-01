/**
 * Scalar coercion for values that arrive from a client.
 *
 * A JSON body can put any shape where a string is expected: `{"text": {...}}`
 * or `{"text": ["a","b"]}` are both valid JSON. Patterns like
 * `payload.text || ''` pass those straight through, so an object reaches a
 * `Json` column and later renders as `[object Object]`, breaks a `.trim()`, or
 * changes the meaning of a Prisma filter it is spliced into.
 *
 * These helpers narrow a value to the type the caller actually expects and fall
 * back rather than throw, because a malformed optional field should not fail a
 * whole request.
 */

/** A string, or `fallback` for anything else (including numbers and null). */
export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** A non-empty string, or `null`. */
export function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A finite number, or `null`. Rejects NaN and Infinity. */
export function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A real boolean, or `fallback`. Does not treat truthy values as `true`. */
export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * An array of non-empty strings, with everything else dropped.
 *
 * Use before splicing client input into a Prisma `{ in: [...] }` filter: a
 * nested object there is interpreted as a query fragment rather than a value.
 */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
}
