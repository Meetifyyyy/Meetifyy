import { verifySync, generateSync, generateSecret } from 'otplib';

/**
 * The TOTP contract with otplib.
 *
 * This exists because the admin second factor was calling an API that no longer
 * existed. otplib 13 removed the `authenticator` singleton, and the code read
 * it off the module with a destructuring `require`, which yields `undefined`
 * rather than failing — so `authenticator.verify(...)` threw a TypeError and
 * every TOTP sign-in became a 500. Nothing caught it: no test touched the
 * library, and the typecheck could not see through `require`.
 *
 * These tests exercise the library the way the service does, so a future major
 * that moves the API again fails here instead of in production.
 */
describe('admin TOTP verification', () => {
  it('exposes the functions the service imports', () => {
    expect(typeof verifySync).toBe('function');
    expect(typeof generateSync).toBe('function');
    expect(typeof generateSecret).toBe('function');
  });

  it('accepts the current code for a secret', () => {
    const secret = generateSecret();
    const token = generateSync({ secret });
    expect(verifySync({ secret, token, epochTolerance: 30 })).toMatchObject({
      valid: true,
    });
  });

  it('rejects a wrong code', () => {
    const secret = generateSecret();
    const token = generateSync({ secret });
    const wrong = token === '000000' ? '111111' : '000000';
    expect(verifySync({ secret, token: wrong, epochTolerance: 30 })).toEqual({
      valid: false,
    });
  });

  it('rejects a code from a different secret', () => {
    const token = generateSync({ secret: generateSecret() });
    expect(
      verifySync({ secret: generateSecret(), token, epochTolerance: 30 }),
    ).toEqual({ valid: false });
  });

  // The failure mode itself: a result object, not a throw, is what lets the
  // service answer 401 instead of 500.
  it('reports an invalid code as a value rather than an exception', () => {
    const secret = generateSecret();
    expect(() =>
      verifySync({ secret, token: '000000', epochTolerance: 30 }),
    ).not.toThrow();
  });
});
