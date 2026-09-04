import {
  clampPageParam,
  parseKeysetCursor,
  singleQueryValue,
} from './pagination.util';

/**
 * Query parameters are typed `string` at the handler and are not necessarily
 * strings.
 *
 * Express parses `?cursor=a&cursor=b` — and `?cursor[]=x` — into an ARRAY,
 * whatever the `@Query('cursor') cursor?: string` annotation claims. Nothing
 * in TypeScript catches that: the lie is at the framework boundary, where no
 * compiler is looking. A handler that then calls `.split()` on the value
 * throws `TypeError: split is not a function`, which reaches the client as a
 * 500 from a URL anyone can type. That is what CodeQL's "type confusion
 * through parameter tampering" alert on campus-events was pointing at.
 */
describe('singleQueryValue', () => {
  it('passes a plain string through', () => {
    expect(singleQueryValue('abc')).toBe('abc');
    expect(singleQueryValue('')).toBe('');
  });

  it('takes the first entry of a repeated parameter', () => {
    // ?cursor=a&cursor=b
    expect(singleQueryValue(['a', 'b'])).toBe('a');
  });

  it('discards values that are neither string nor array of strings', () => {
    // String(['a','b']) would silently produce the nonsense cursor "a,b";
    // there is no sensible single value here, so there is no value.
    expect(singleQueryValue(undefined)).toBeUndefined();
    expect(singleQueryValue(null)).toBeUndefined();
    expect(singleQueryValue(42)).toBeUndefined();
    expect(singleQueryValue({ a: 1 })).toBeUndefined();
    expect(singleQueryValue([])).toBeUndefined();
    expect(singleQueryValue([{ nested: true }])).toBeUndefined();
  });

  it('finds the first string past non-string entries', () => {
    // ?cursor[][x]=1&cursor=real
    expect(singleQueryValue([{ x: 1 } as any, 'real'])).toBe('real');
  });
});

describe('parseKeysetCursor', () => {
  const ISO = '2026-01-02T03:04:05.000Z';

  it('parses a well-formed cursor', () => {
    const parsed = parseKeysetCursor(`${ISO}|evt-1`);
    expect(parsed).not.toBeNull();
    expect(parsed!.date.toISOString()).toBe(ISO);
    expect(parsed!.id).toBe('evt-1');
  });

  it('never throws on a tampered parameter, whatever its type', () => {
    // Each of these used to reach `.split()` (or `.includes()`) on a
    // non-string and take the endpoint down with a 500.
    for (const raw of [
      [`${ISO}|evt-1`, `${ISO}|evt-2`],
      ['|'],
      [],
      42,
      { toString: () => `${ISO}|evt-1` },
      null,
      undefined,
      true,
    ]) {
      expect(() => parseKeysetCursor(raw as any)).not.toThrow();
    }
  });

  it('accepts a repeated parameter by using its first value', () => {
    const parsed = parseKeysetCursor([`${ISO}|evt-1`, 'garbage']);
    expect(parsed!.id).toBe('evt-1');
  });

  it('returns null for anything unusable, so the caller shows page one', () => {
    // A bad cursor is a client mistake; it must cost a first page, not a 500.
    expect(parseKeysetCursor(undefined)).toBeNull();
    expect(parseKeysetCursor('')).toBeNull();
    expect(parseKeysetCursor('no-separator')).toBeNull();
    expect(parseKeysetCursor(`${ISO}|`)).toBeNull();
    expect(parseKeysetCursor('not-a-date|evt-1')).toBeNull();
    expect(parseKeysetCursor('|evt-1')).toBeNull();
  });

  it('keeps an id that itself contains the separator', () => {
    // Destructuring `split('|')` into two names silently truncated such an id
    // and paginated from the wrong row.
    const parsed = parseKeysetCursor(`${ISO}|weird|id`);
    expect(parsed!.id).toBe('weird|id');
  });
});

describe('clampPageParam', () => {
  it('bounds a page size and falls back on nonsense', () => {
    const opts = { def: 20, max: 50, min: 1 };
    expect(clampPageParam(undefined, opts)).toBe(20);
    expect(clampPageParam('', opts)).toBe(20);
    expect(clampPageParam('abc', opts)).toBe(20);
    expect(clampPageParam('999999', opts)).toBe(50);
    expect(clampPageParam('-1', opts)).toBe(1);
    expect(clampPageParam('30', opts)).toBe(30);
  });
});
