import { describe, it, expect } from 'vitest';
import {
  COMMENT_MAX_CHARS,
  POST_MAX_CHARS,
  countChars,
  getCommentLimitState,
  getPostLimitState,
} from '../textLimit';

describe('countChars', () => {
  it('counts plain text, spaces and line breaks', () => {
    expect(countChars('')).toBe(0);
    expect(countChars('hello')).toBe(5);
    expect(countChars('a b\n\nc')).toBe(6);
  });

  it('counts an emoji as one character, as the server does', () => {
    expect(countChars('😀')).toBe(1);
    expect(countChars('hi 😀😀')).toBe(5);
  });

  it('counts a variation selector, as the column does', () => {
    expect(countChars('❤️')).toBe(2);
  });

  it('is zero for a non-string', () => {
    expect(countChars(undefined)).toBe(0);
  });
});

describe('getCommentLimitState', () => {
  const chars = (n) => 'a'.repeat(n);

  it('is 500', () => {
    expect(COMMENT_MAX_CHARS).toBe(500);
  });

  it('hides the counter for a short comment', () => {
    expect(getCommentLimitState('nice one').status).toBe('ok');
  });

  it('shows the counter from 400 characters', () => {
    expect(getCommentLimitState(chars(399)).status).toBe('ok');
    expect(getCommentLimitState(chars(400)).status).toBe('near');
  });

  it('allows exactly 500', () => {
    const s = getCommentLimitState(chars(500));
    expect(s.isOver).toBe(false);
    expect(s.remaining).toBe(0);
  });

  it('blocks 501 and says by how much', () => {
    const s = getCommentLimitState(chars(501));
    expect(s.isOver).toBe(true);
    expect(s.overBy).toBe(1);
  });

  it('judges a multiline paste as a whole, line breaks included', () => {
    expect(getCommentLimitState(`${chars(249)}\n\n${chars(249)}`).isOver).toBe(false);
    expect(getCommentLimitState(`${chars(300)}\n${chars(300)}`).overBy).toBe(101);
  });

  it('treats whitespace alone as empty', () => {
    const s = getCommentLimitState('  \n\t ');
    expect(s.isEmpty).toBe(true);
    expect(s.isOver).toBe(false);
  });
});

describe('getPostLimitState', () => {
  const chars = (n) => 'a'.repeat(n);

  it('is 2,000', () => {
    expect(POST_MAX_CHARS).toBe(2000);
  });

  it('shows the counter from 1,800 characters', () => {
    expect(getPostLimitState(chars(1799)).status).toBe('ok');
    expect(getPostLimitState(chars(1800)).status).toBe('near');
  });

  it('allows exactly 2,000 and blocks 2,001', () => {
    expect(getPostLimitState(chars(2000)).isOver).toBe(false);
    const over = getPostLimitState(chars(2001));
    expect(over.isOver).toBe(true);
    expect(over.overBy).toBe(1);
  });

  it('counts emoji as one character each', () => {
    expect(getPostLimitState('😀'.repeat(2000)).isOver).toBe(false);
    expect(getPostLimitState('😀'.repeat(2001)).isOver).toBe(true);
  });
});
