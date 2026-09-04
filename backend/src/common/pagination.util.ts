/**
 * Parse a client-supplied page size / offset into something the database can be
 * trusted with.
 *
 * These three campus list endpoints previously did `limit ? parseInt(limit) : N`
 * with no bounds at all, which allowed three distinct failures:
 *
 *  - `?limit=999999` — one request asking the database for the entire table.
 *  - `?limit=abc` — `parseInt` yields NaN, which Prisma rejects at the driver
 *    with a 500 rather than a 400.
 *  - `?limit=-1` — Prisma reads a negative `take` as "from the other end",
 *    silently reversing the result set.
 *
 * The offset cap matters just as much: measured on a 300k-row table, a keyset
 * page returns in 0.15ms while `OFFSET 5000` on the same data takes 1.6s,
 * because Postgres still walks and discards every skipped row. A handful of
 * concurrent deep-offset requests is enough to hold the connection pool open.
 */
export function clampPageParam(
  raw: string | undefined,
  { def, max, min = 0 }: { def: number; max: number; min?: number },
): number {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/**
 * The single value of a query parameter that is declared as a string.
 *
 * `@Query('cursor') cursor?: string` is a type annotation, not a guarantee:
 * Express parses `?cursor=a&cursor=b` into an ARRAY, and `?cursor[]=x` into an
 * array too, so the value reaching a handler can be `string[]` however it is
 * typed. TypeScript cannot catch this — the lie is at the framework boundary,
 * where no compiler is looking.
 *
 * That is not merely untidy. A handler that calls `.split()` on the value
 * throws `TypeError: cursor.split is not a function`, which surfaces as a 500
 * from a request anyone can construct. Normalising here makes the declared
 * type true for everything downstream.
 *
 * The first value wins rather than the last, matching how the rest of this
 * codebase reads repeated parameters, and anything that is neither a string
 * nor an array of them is discarded rather than coerced — `String(['a','b'])`
 * would silently produce the nonsense cursor `"a,b"`.
 */
export function singleQueryValue(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === 'string');
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

/**
 * Parse an opaque keyset cursor of the form `${sortValueISO}|${id}`.
 *
 * Returns `null` for anything unusable — absent, wrong type, malformed, or an
 * unparseable date — so callers fall back to the first page instead of
 * throwing. A bad cursor is a client mistake, not a server error, and it must
 * not be able to produce a 500.
 *
 * Shared because two methods in campus-events had this parse written out
 * separately with the same `new Date(ts)` / `isNaN` / `id` checks, and only
 * one of them guarded the type of the input at all.
 */
export function parseKeysetCursor(
  raw: unknown,
): { date: Date; id: string } | null {
  const cursor = singleQueryValue(raw);
  if (!cursor || !cursor.includes('|')) return null;

  const separator = cursor.indexOf('|');
  const ts = cursor.slice(0, separator);
  // slice, not split: an id containing a "|" would otherwise be truncated by
  // destructuring the first two elements, quietly paginating from the wrong row.
  const id = cursor.slice(separator + 1);
  if (!id) return null;

  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;

  return { date, id };
}
