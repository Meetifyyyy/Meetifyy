import { describe, it, expect } from 'vitest';
import { markMatches } from '../../components/mentions/RichText';

/** The visible text of whatever markMatches returned, marks included. */
const flatten = (out) =>
  (Array.isArray(out) ? out : [out])
    .map((part) => (typeof part === 'string' ? part : part.props.children))
    .join('');

/** Just the substrings that got wrapped in a <mark>. */
const hits = (out) =>
  (Array.isArray(out) ? out : [])
    .filter((part) => typeof part !== 'string')
    .map((part) => part.props.children);

describe('find-in-chat highlighting', () => {
  it('returns the text untouched when there is no term or no match', () => {
    expect(markMatches('hello there', '', 'k', 'c')).toBe('hello there');
    expect(markMatches('hello there', 'zzz', 'k', 'c')).toBe('hello there');
    expect(markMatches('', 'hello', 'k', 'c')).toBe('');
  });

  it('marks a match without losing or duplicating any text', () => {
    // The index arithmetic is the whole risk here: an off-by-one silently
    // drops or repeats characters inside people's messages.
    const out = markMatches('meet me at the cafe', 'me', 'k', 'c');
    expect(flatten(out)).toBe('meet me at the cafe');
  });

  it('marks every occurrence, not just the first', () => {
    const out = markMatches('ba ba black sheep', 'ba', 'k', 'c');
    expect(hits(out)).toEqual(['ba', 'ba']);
    expect(flatten(out)).toBe('ba ba black sheep');
  });

  it('matches case-insensitively but preserves the original casing', () => {
    const out = markMatches('Hello HELLO hello', 'hello', 'k', 'c');
    expect(hits(out)).toEqual(['Hello', 'HELLO', 'hello']);
    expect(flatten(out)).toBe('Hello HELLO hello');
  });

  it('handles a match at the very start and very end', () => {
    expect(flatten(markMatches('abc', 'a', 'k', 'c'))).toBe('abc');
    expect(hits(markMatches('abc', 'a', 'k', 'c'))).toEqual(['a']);
    expect(flatten(markMatches('abc', 'c', 'k', 'c'))).toBe('abc');
    expect(hits(markMatches('abc', 'c', 'k', 'c'))).toEqual(['c']);
  });

  it('leaves non-string input alone rather than throwing', () => {
    expect(markMatches(null, 'x', 'k', 'c')).toBe(null);
    expect(markMatches(undefined, 'x', 'k', 'c')).toBe(undefined);
  });
});
