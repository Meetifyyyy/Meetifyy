import { describe, expect, it } from 'vitest';
import { ellipsize, wrapLines } from '../draw';

// Every character is 10px wide: enough to reason about wrapping exactly.
const ctx = { measureText: (t) => ({ width: String(t).length * 10 }) };

describe('wrapLines', () => {
  it('wraps on words within the width', () => {
    expect(wrapLines(ctx, 'aaa bbb ccc', 70, 5)).toEqual(['aaa bbb', 'ccc']);
  });

  it('breaks a word longer than a line', () => {
    expect(wrapLines(ctx, 'abcdefghij', 40, 5)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('keeps paragraph breaks but never a leading or doubled blank line', () => {
    expect(wrapLines(ctx, 'aa\n\n\nbb', 100, 5)).toEqual(['aa', '', 'bb']);
  });

  it('ellipsises the last permitted line when text remains', () => {
    const lines = wrapLines(ctx, 'aaa bbb ccc ddd eee', 70, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    lines.forEach((l) => expect(l.length * 10).toBeLessThanOrEqual(70));
  });
});

describe('ellipsize', () => {
  it('leaves text that fits alone and truncates text that does not', () => {
    expect(ellipsize(ctx, 'abc', 30)).toBe('abc');
    const cut = ellipsize(ctx, 'abcdefgh', 50);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length * 10).toBeLessThanOrEqual(50);
  });
});
