import { describe, expect, it } from 'vitest';
import { isPublicPath } from '../paths';

describe('isPublicPath: support routes', () => {
  it('keeps the help centre, the public form and the health check public', () => {
    expect(isPublicPath('/api/support/help')).toBe(true);
    expect(isPublicPath('/api/support/meta')).toBe(true);
    expect(isPublicPath('/api/support/requests')).toBe(true);
    expect(isPublicPath('/health')).toBe(true);
  });

  it('treats the account\'s own requests as signed-in, so a 401 renews the session', () => {
    expect(isPublicPath('/api/support/requests/mine')).toBe(false);
    expect(isPublicPath('/api/support/requests/mine?x=1')).toBe(false);
    expect(isPublicPath('/api/support/requests/mine/MFT-ABC123')).toBe(false);
  });
});
