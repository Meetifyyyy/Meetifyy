import { redact } from './http-exception.filter';

/**
 * `redact` scrubs request bodies and error payloads before they are logged.
 * These pin its exact output, so a refactor that changes what reaches the log
 * fails here rather than in a log line nobody reads until an incident.
 */
describe('redact', () => {
  it('replaces every sensitive field, case-insensitively', () => {
    expect(
      redact({
        Password: 'p',
        newPassword: 'n',
        confirmPassword: 'c',
        accessToken: 'a',
        RefreshToken: 'r',
        authorization: 'Bearer x',
        cookie: 'mf_access=1',
        OTP: '123456',
        verificationCode: '999',
        secret: 's',
        apiKey: 'k',
        token: 't',
        email: 'kept@uni.edu',
      }),
    ).toEqual({
      Password: '[REDACTED]',
      newPassword: '[REDACTED]',
      confirmPassword: '[REDACTED]',
      accessToken: '[REDACTED]',
      RefreshToken: '[REDACTED]',
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      OTP: '[REDACTED]',
      verificationCode: '[REDACTED]',
      secret: '[REDACTED]',
      apiKey: '[REDACTED]',
      token: '[REDACTED]',
      email: 'kept@uni.edu',
    });
  });

  it('recurses into nested objects and arrays', () => {
    expect(
      redact({
        user: { name: 'a', password: 'p', devices: [{ token: 't', os: 'x' }] },
        list: [{ otp: '1' }, 'plain', 3],
      }),
    ).toEqual({
      user: {
        name: 'a',
        password: '[REDACTED]',
        devices: [{ token: '[REDACTED]', os: 'x' }],
      },
      list: [{ otp: '[REDACTED]' }, 'plain', 3],
    });
  });

  it('redacts a sensitive key whatever its value is', () => {
    expect(redact({ token: { nested: 'x' }, password: null })).toEqual({
      token: '[REDACTED]',
      password: '[REDACTED]',
    });
  });

  it('returns primitives and empty values unchanged', () => {
    expect(redact('password=x')).toBe('password=x');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact([])).toEqual([]);
  });

  it('never mutates its input', () => {
    const input = { password: 'p', inner: { token: 't' } };
    redact(input);
    expect(input).toEqual({ password: 'p', inner: { token: 't' } });
  });
});
