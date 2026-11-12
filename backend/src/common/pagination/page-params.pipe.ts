import { Injectable, PipeTransform } from '@nestjs/common';
import { singleQueryValue } from '../pagination.util';

/**
 * Query-string pagination parameters, parsed and bounded in one place.
 *
 * Each handler used to do its own `parseInt(limit, 10)`, and most of them did
 * nothing else: `?limit=100000` made one request read a whole table, `?limit=abc`
 * handed Prisma a NaN (a 500), and `?limit=-1` made Prisma read from the other
 * end. A deep `offset` is the same problem in slow motion, because Postgres
 * still walks and discards every skipped row.
 *
 * None of these pipes ever rejects. An installed app ships a frozen client, so
 * a value that worked yesterday must not become a 400 today: junk falls back to
 * the site's default and an oversized value is clamped to the site's maximum.
 */

/**
 * The first usable number in a raw query value, floored, or `undefined` when
 * there is none.
 *
 * `?limit=1&limit=2` reaches a handler as an array whatever the parameter is
 * typed as, so the first value wins (as everywhere else in the codebase).
 * `parseFloat` rather than `Number` keeps the old `parseInt` leniency for
 * "20px"-style values; a decimal is floored, and Infinity is not a number
 * anyone meant.
 */
function parseWholeNumber(raw: unknown): number | undefined {
  const text = singleQueryValue(raw);
  if (text === undefined) return undefined;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

export interface PageLimitOptions {
  /** Used when the value is absent, unparseable, zero or negative. */
  default: number;
  /** Anything above this is clamped down to it. */
  max: number;
}

/** A page size: always a whole number in `1..max`. */
@Injectable()
export class PageLimitPipe implements PipeTransform<unknown, number> {
  constructor(private readonly options: PageLimitOptions) {}

  transform(value: unknown): number {
    const parsed = parseWholeNumber(value);
    if (parsed === undefined || parsed < 1) return this.options.default;
    return Math.min(parsed, this.options.max);
  }
}

export interface OffsetOptions {
  /** Anything above this is clamped down to it. */
  max: number;
}

/** A row offset: always a whole number in `0..max`; absent or junk is 0. */
@Injectable()
export class OffsetPipe implements PipeTransform<unknown, number> {
  constructor(private readonly options: OffsetOptions) {}

  transform(value: unknown): number {
    const parsed = parseWholeNumber(value);
    if (parsed === undefined || parsed < 0) return 0;
    return Math.min(parsed, this.options.max);
  }
}

/** A 1-based page number: always a whole number in `1..max`. */
@Injectable()
export class PageNumberPipe implements PipeTransform<unknown, number> {
  constructor(private readonly options: OffsetOptions) {}

  transform(value: unknown): number {
    const parsed = parseWholeNumber(value);
    if (parsed === undefined || parsed < 1) return 1;
    return Math.min(parsed, this.options.max);
  }
}
