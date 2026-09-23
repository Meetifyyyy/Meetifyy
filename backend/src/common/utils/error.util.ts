/**
 * What a caught value says about itself, for a log line.
 *
 * A `catch` binding is `unknown`: anything can be thrown, and libraries do
 * throw strings, plain objects and `null`. The pattern this replaces,
 * `${err.message}` on an untyped binding, printed "undefined" for all of those
 * and threw a TypeError inside the catch block for `null`, losing the original
 * failure. An Error gives its message; anything else is stringified.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/** The stack of an Error, or undefined for anything else that was thrown. */
export function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}
