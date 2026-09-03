/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  validatePassword,
} from '@features/auth/shared/passwordRules';

describe('the password rules themselves', () => {
  it('caps at 72, the limit bcrypt actually applies', () => {
    expect(PASSWORD_MAX_LENGTH).toBe(72);
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it('accepts a password exactly at each boundary', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(validatePassword('a'.repeat(PASSWORD_MAX_LENGTH))).toBeNull();
  });

  it('rejects one character over the limit, with the limit named', () => {
    const msg = validatePassword('a'.repeat(PASSWORD_MAX_LENGTH + 1));
    expect(msg).toBe("Password can't exceed 72 characters.");
  });

  it('rejects one character under the minimum', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)))
      .toBe('Password must be at least 8 characters.');
  });

  it('requires something', () => {
    expect(validatePassword('')).toBe('Password is required.');
    expect(validatePassword(null)).toBe('Password is required.');
  });

  it('counts spaces towards the length rather than ignoring them', () => {
    expect(validatePassword(' abcdefg ')).toBeNull();
    expect(validatePassword('      ')).toBe('Password must be at least 8 characters.');
  });

  it('measures bytes, because that is what bcrypt truncates on', () => {
    // 40 two-byte characters is 80 bytes: under the character count, over the
    // byte limit, and bcrypt would ignore everything past byte 72.
    expect(validatePassword('é'.repeat(40))).toBe("Password can't exceed 72 characters.");
    // 36 of them is exactly 72 bytes, which fits.
    expect(validatePassword('é'.repeat(36))).toBeNull();
  });

  it('accepts every printable character, spaces and passphrases included', () => {
    expect(validatePassword('correct horse battery staple')).toBeNull();
    expect(validatePassword(String.raw`aB3!£$%^&*()_+{}|:"<>?~-=[];',./`)).toBeNull();
    expect(validatePassword('пароль-с-кириллицей')).toBeNull();
  });
});
