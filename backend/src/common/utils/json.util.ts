import type { Prisma } from '@prisma/client';

/**
 * Whether `value` is plain JSON: null, a string, a finite number, a boolean,
 * or an array or plain object of those, all the way down.
 *
 * A value that came from a parsed request body always is; this is the runtime
 * proof the compiler needs before such a value is written to a Json column,
 * instead of asserting it.
 */
export function isJsonValue(
  value: unknown,
): value is Prisma.InputJsonValue | null {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      if (Array.isArray(value)) return value.every(isJsonValue);
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      return Object.values(value).every(
        (v) => v === undefined || isJsonValue(v),
      );
    default:
      return false;
  }
}
