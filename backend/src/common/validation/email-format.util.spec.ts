import {
  checkEmailFormat,
  EmailFormat,
  isValidEmailFormat,
  normalizeEmail,
} from './email-format.util';

/**
 * These cases are the specification, not a sample.
 *
 * The bug this file guards against was a permissive regex —
 * `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` — that accepted `student@gla.ac.`, because its
 * trailing group matches `ac.` (a dot is neither whitespace nor an `@`). That
 * half-typed address then reached the availability endpoint, was refused there
 * as malformed, and the client reported the refusal as a connectivity problem
 * and offered to let the user continue.
 *
 * The frontend mirror lives in `frontend/src/shared/utils/emailValidation.js`
 * and must agree with every case below.
 */
describe('checkEmailFormat', () => {
  describe('accepts complete addresses', () => {
    it.each([
      'student@gla.ac.in',
      'student@gmail.com',
      // Two labels with a two-letter TLD is well-formed. Whether the domain is
      // *allowed* is a separate question answered by DomainValidatorService.
      'student@gla.ac',
      'student@sub.gla.ac.in',
      'student.name+tag@gla.ac.in',
      "o'brien@gla.ac.in",
      'student@gla-university.ac.in',
    ])('%s', (email) => {
      expect(checkEmailFormat(email).valid).toBe(true);
    });

    it('is case- and whitespace-insensitive', () => {
      expect(checkEmailFormat('  STUDENT@GLA.AC.IN  ').valid).toBe(true);
      expect(checkEmailFormat('  STUDENT@GLA.AC.IN  ').domain).toBe(
        'gla.ac.in',
      );
    });
  });

  describe('rejects incomplete or malformed addresses', () => {
    it.each([
      // The exact regression: a trailing dot in the domain.
      ['student@gla.ac.', 'trailing dot'],
      ['student@gla.', 'trailing dot, single label'],
      ['student@', 'no domain'],
      ['student@gla', 'no TLD'],
      ['student@localhost', 'single label'],
      ['student', 'no @'],
      ['@gla.ac.in', 'no local part'],
      ['student@.gla.ac.in', 'leading dot'],
      ['student@gla..ac.in', 'consecutive dots'],
      ['student@-gla.ac.in', 'label starts with hyphen'],
      ['student@gla-.ac.in', 'label ends with hyphen'],
      ['student@gla.ac.i', 'one-character TLD'],
      ['student@gla.ac.1n', 'numeric TLD'],
      ['a@b@gla.ac.in', 'two @ symbols'],
      ['stu dent@gla.ac.in', 'space in local part'],
      [
        'student@gla.ac.in ',
        'trailing space is trimmed, but this one is valid',
      ],
    ])('%s (%s)', (email) => {
      // The last row is deliberately valid after trimming; assert per-case.
      const expected = email.trim() === 'student@gla.ac.in';
      expect(checkEmailFormat(email).valid).toBe(expected);
    });

    it('reports an empty value as required, not invalid', () => {
      expect(checkEmailFormat('').code).toBe(EmailFormat.Required);
      expect(checkEmailFormat('   ').code).toBe(EmailFormat.Required);
      expect(checkEmailFormat('nope').code).toBe(EmailFormat.Invalid);
    });

    it('rejects non-strings without throwing', () => {
      for (const v of [null, undefined, 42, {}, []]) {
        expect(isValidEmailFormat(v)).toBe(false);
      }
    });

    it('enforces length limits', () => {
      expect(isValidEmailFormat(`${'a'.repeat(65)}@gla.ac.in`)).toBe(false);
      expect(isValidEmailFormat(`${'a'.repeat(64)}@gla.ac.in`)).toBe(true);
      expect(isValidEmailFormat(`a@${'b'.repeat(64)}.ac.in`)).toBe(false);
    });

    it('strips zero-width characters rather than letting them disguise input', () => {
      // A zero-width space inside the domain must not produce a "valid" address
      // that then resolves to a different domain than the one displayed.
      expect(isValidEmailFormat('student@gla​.ac.in')).toBe(true);
      expect(checkEmailFormat('student@gla​.ac.in').domain).toBe('gla.ac.in');
    });
  });

  describe('normalizeEmail', () => {
    it('trims and lowercases only', () => {
      expect(normalizeEmail('  Student@GLA.ac.in ')).toBe('student@gla.ac.in');
    });

    it('does not repair a malformed address into a valid one', () => {
      // Critically: no trailing-dot stripping here. Repairing the value would
      // sign the user up with an address they did not type.
      expect(normalizeEmail('student@gla.ac.')).toBe('student@gla.ac.');
      expect(isValidEmailFormat(normalizeEmail('student@gla.ac.'))).toBe(false);
    });
  });
});
