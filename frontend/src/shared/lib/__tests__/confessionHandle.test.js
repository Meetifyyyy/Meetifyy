import { describe, it, expect } from 'vitest';
import { validateHandle, suggestHandles, HANDLE_MAX } from '../confessionHandle';

describe('validateHandle', () => {
  it.each([
    ['ab', 'short'],
    ['a'.repeat(HANDLE_MAX + 1), 'long'],
    ['1fox', 'start'],
    ['_fox', 'start'],
    ['fox-tail', 'chars'],
    ['fox tail', 'chars'],
    ['fox..tail', 'repeat'],
    ['fox._tail', 'repeat'],
    ['foxtail.', 'end'],
    ['foxtail_', 'end'],
    ['Admin', 'reserved'],
    ['meetifyy', 'reserved'],
  ])('refuses %j (%s)', (handle, reason) => {
    expect(validateHandle(handle)).toEqual({ ok: false, reason });
  });

  it.each(['fox', 'quiet.fox', 'Velvet_Moth42', 'a'.repeat(HANDLE_MAX)])('accepts %j', (handle) => {
    expect(validateHandle(handle).ok).toBe(true);
  });

  it('treats non-strings as empty', () => {
    expect(validateHandle(undefined)).toEqual({ ok: false, reason: 'short' });
  });
});

describe('suggestHandles', () => {
  it('only suggests names that pass the rules, without repeats', () => {
    for (let i = 0; i < 20; i += 1) {
      const names = suggestHandles(3);
      expect(names).toHaveLength(3);
      expect(new Set(names).size).toBe(3);
      names.forEach((n) => expect(validateHandle(n).ok).toBe(true));
    }
  });
});
