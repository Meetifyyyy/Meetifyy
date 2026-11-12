import { isOriginAuthExempt, isOriginAuthorized } from './origin-auth';

const SECRET = 'a'.repeat(48);

describe('origin auth', () => {
  it('is off when no secret is configured', () => {
    expect(isOriginAuthorized(undefined, '')).toBe(true);
    expect(isOriginAuthorized('anything', '')).toBe(true);
  });

  it('accepts only the exact secret', () => {
    expect(isOriginAuthorized(SECRET, SECRET)).toBe(true);
    expect(isOriginAuthorized(`${SECRET}x`, SECRET)).toBe(false);
    expect(isOriginAuthorized(SECRET.slice(1), SECRET)).toBe(false);
    expect(isOriginAuthorized(SECRET.toUpperCase(), SECRET)).toBe(false);
  });

  it('refuses a missing, empty or repeated header', () => {
    expect(isOriginAuthorized(undefined, SECRET)).toBe(false);
    expect(isOriginAuthorized('', SECRET)).toBe(false);
    expect(isOriginAuthorized([SECRET, SECRET], SECRET)).toBe(false);
  });

  it('exempts the health check and nothing that merely resembles it', () => {
    expect(isOriginAuthExempt('/health')).toBe(true);
    expect(isOriginAuthExempt('/health/')).toBe(true);
    expect(isOriginAuthExempt('/health?x=1')).toBe(true);
    expect(isOriginAuthExempt('/healthz')).toBe(false);
    expect(isOriginAuthExempt('/health/../api/auth/login')).toBe(false);
    expect(isOriginAuthExempt('/api/health')).toBe(false);
    expect(isOriginAuthExempt('/socket.io/')).toBe(false);
  });
});
