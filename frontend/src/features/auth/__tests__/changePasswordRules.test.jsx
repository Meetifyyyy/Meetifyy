/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  validatePasswordChange,
} from '@features/auth/shared/passwordRules';

/**
 * The Settings → Security panel used to validate with a bare `length < 8` of
 * its own, so it disagreed with signup and reset about both the upper limit and
 * the wording. These assert the three screens now answer the same question the
 * same way.
 */
describe('change-password validation', () => {
  const ok = {
    currentPassword: 'old-password',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  };

  it('accepts a well-formed change', () => {
    expect(validatePasswordChange(ok)).toEqual({});
  });

  it('names each empty field rather than one generic "password required"', () => {
    const errors = validatePasswordChange({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
    expect(errors.current).toBe('Current password is required');
    expect(errors.new).toBe('New password is required');
  });

  it('applies the shared minimum, worded as signup and reset word it', () => {
    const errors = validatePasswordChange({ ...ok, newPassword: 'short', confirmPassword: 'short' });
    expect(errors.new).toBe('Password must be at least 8 characters.');
  });

  it('applies the 72-byte bcrypt cap the panel used to have no notion of', () => {
    const long = 'a'.repeat(PASSWORD_MAX_LENGTH + 1);
    const errors = validatePasswordChange({ ...ok, newPassword: long, confirmPassword: long });
    expect(errors.new).toBe("Password can't exceed 72 characters.");
  });

  it('counts bytes, not characters, for that cap', () => {
    const over = 'é'.repeat(40); // 80 bytes
    expect(validatePasswordChange({ ...ok, newPassword: over, confirmPassword: over }).new)
      .toBe("Password can't exceed 72 characters.");
    const fits = 'é'.repeat(36); // exactly 72 bytes
    expect(validatePasswordChange({ ...ok, newPassword: fits, confirmPassword: fits })).toEqual({});
  });

  it('reports reuse of the current password as reuse', () => {
    const errors = validatePasswordChange({
      currentPassword: 'same-password',
      newPassword: 'same-password',
      confirmPassword: 'same-password',
    });
    expect(errors.new).toBe('Must differ from your current password');
  });

  it('catches a mismatched confirmation', () => {
    const errors = validatePasswordChange({ ...ok, confirmPassword: 'something-else' });
    expect(errors.confirm).toBe('Passwords do not match');
  });

  it('does not trim, so whitespace is carried into the comparison', () => {
    // Reset and signup both leave the password exactly as typed; a panel that
    // trimmed would accept a confirmation the user had not actually entered.
    const errors = validatePasswordChange({
      currentPassword: 'old-password',
      newPassword: 'with a space ',
      confirmPassword: 'with a space',
    });
    expect(errors.confirm).toBe('Passwords do not match');
  });
});
