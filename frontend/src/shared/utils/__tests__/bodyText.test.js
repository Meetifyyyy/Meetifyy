import { describe, it, expect } from 'vitest';
import {
  normalizeBodyText,
  truncateBodyText,
  clipMentions,
  POST_LIMITS,
  COMMENT_LIMITS,
} from '../bodyText';

describe('normalizeBodyText', () => {
  it('trims and normalises line endings', () => {
    expect(normalizeBodyText('  hi  ')).toBe('hi');
    expect(normalizeBodyText('a\r\nb')).toBe('a\nb');
  });

  it('collapses a run of blank lines to a single paragraph break', () => {
    // One blank line is a deliberate paragraph break and survives; a screen of
    // emptiness from someone holding Enter does not.
    expect(normalizeBodyText('a\n\nb')).toBe('a\n\nb');
    expect(normalizeBodyText('a\n\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('handles empty and nullish input', () => {
    expect(normalizeBodyText('')).toBe('');
    expect(normalizeBodyText(null)).toBe('');
    expect(normalizeBodyText(undefined)).toBe('');
  });
});

describe('truncateBodyText', () => {
  it('leaves short text alone and reports no truncation', () => {
    const out = truncateBodyText('short', POST_LIMITS);
    expect(out).toEqual({ text: 'short', needsTruncation: false });
  });

  it('clips on the character limit', () => {
    const long = 'x'.repeat(400);
    const out = truncateBodyText(long, POST_LIMITS);
    expect(out.needsTruncation).toBe(true);
    expect(out.text).toBe(`${'x'.repeat(300)}...`);
  });

  it('clips on the line limit even when well under the character limit', () => {
    // Both limits matter and neither implies the other: 20 short lines is a
    // wall of text the character count never notices.
    const many = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    expect(many.length).toBeLessThan(POST_LIMITS.maxChars);
    const out = truncateBodyText(many, POST_LIMITS);
    expect(out.needsTruncation).toBe(true);
    expect(out.text.replace(/\.\.\.$/, '').split('\n')).toHaveLength(POST_LIMITS.maxLines);
  });

  it('gives comments a tighter budget than posts', () => {
    const body = 'y'.repeat(260);
    expect(truncateBodyText(body, POST_LIMITS).needsTruncation).toBe(false);
    expect(truncateBodyText(body, COMMENT_LIMITS).needsTruncation).toBe(true);
  });

  it('never promises text that is not there', () => {
    // Exactly at the limit: nothing was removed, so no ellipsis.
    const exact = 'z'.repeat(POST_LIMITS.maxChars);
    expect(truncateBodyText(exact, POST_LIMITS).text.endsWith('...')).toBe(false);
  });
});

describe('clipMentions', () => {
  const mentions = [
    { username: 'ana', start: 0, end: 4 },
    { username: 'bo', start: 50, end: 53 },
  ];

  it('keeps only mentions that end inside the visible slice', () => {
    // RichText places structured mentions by absolute index, so one running
    // past the clip would slice into the ellipsis.
    expect(clipMentions(mentions, 'x'.repeat(20))).toEqual([mentions[0]]);
    expect(clipMentions(mentions, 'x'.repeat(100))).toEqual(mentions);
  });

  it('excludes the ellipsis from the visible length', () => {
    const shown = `${'x'.repeat(52)}...`;
    // 55 chars rendered, but only 52 are real text — @bo ends at 53.
    expect(clipMentions(mentions, shown)).toEqual([mentions[0]]);
  });

  it('tolerates missing or malformed mentions', () => {
    expect(clipMentions(null, 'abc')).toEqual([]);
    expect(clipMentions([{ username: 'x' }], 'abc')).toEqual([]);
  });
});
