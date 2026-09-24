/**
 * A plain object whose fields can be read and narrowed one at a time.
 *
 * The shape of anything parsed from outside (a JSON body, a token header, a
 * third-party response) is unknown until checked. Arrays are excluded: an
 * array is an object, but reading named fields off one is never intended.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string field of an object, or undefined when it is absent or not a string. */
export function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}
