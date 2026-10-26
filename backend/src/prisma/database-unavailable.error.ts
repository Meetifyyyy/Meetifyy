/**
 * The database cannot be used: the service is shutting down and its pool is
 * closed.
 *
 * Thrown by PrismaService's middleware for any query issued after the pool has
 * closed. It used to answer such queries with `undefined`, which no caller
 * expects from `findMany` or `deleteMany`, so the failure surfaced later as an
 * unrelated TypeError ("Cannot read properties of undefined (reading
 * 'count')", "expired is not iterable"). A named error says what happened, and
 * fails the job or request where it was asked.
 */
export class DatabaseUnavailableError extends Error {
  readonly name = 'DatabaseUnavailableError';

  constructor(cause?: unknown) {
    super('The database is unavailable: the service is shutting down', {
      cause,
    });
  }
}
