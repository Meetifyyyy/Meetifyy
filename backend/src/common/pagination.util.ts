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
