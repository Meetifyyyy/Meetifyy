import {
  COMMENT_MAX_CHARS,
  POST_MAX_CHARS,
  countChars,
} from './text-length.util';

describe('countChars', () => {
  it('limits match the column widths', () => {
    expect(COMMENT_MAX_CHARS).toBe(500);
    expect(POST_MAX_CHARS).toBe(2000);
  });

  it('counts plain text, whitespace and line breaks', () => {
    expect(countChars('')).toBe(0);
    expect(countChars('hello')).toBe(5);
    expect(countChars('a b\n\nc')).toBe(6);
    expect(countChars('   ')).toBe(3);
  });

  it('counts an emoji as one character, as Postgres does', () => {
    expect('😀'.length).toBe(2);
    expect(countChars('😀')).toBe(1);
    expect(countChars('hi 😀😀')).toBe(5);
  });

  it('counts a variation selector, which class-validator would skip', () => {
    // U+2764 U+FE0F: two code points, two characters in a VARCHAR.
    expect(countChars('❤️')).toBe(2);
  });

  it('counts Devanagari by code point', () => {
    expect(countChars('नमस्ते')).toBe([...'नमस्ते'].length);
  });
});
