import type { Request } from 'express';
import { currentSessionId } from './current-session-id';
import {
  USER_SESSION_ID_COOKIE,
  USER_SESSION_ID_HEADER,
} from './user-session-cookies';

const req = (init: {
  cookies?: Record<string, unknown>;
  headers?: Record<string, string>;
}) => init as unknown as Request;

describe('currentSessionId', () => {
  it('reads the web cookie', () => {
    expect(
      currentSessionId(req({ cookies: { [USER_SESSION_ID_COOKIE]: 'c1' } })),
    ).toBe('c1');
  });

  it('falls back to the installed app header', () => {
    expect(
      currentSessionId(req({ headers: { [USER_SESSION_ID_HEADER]: ' h1 ' } })),
    ).toBe('h1');
  });

  it('prefers the cookie over the header', () => {
    expect(
      currentSessionId(
        req({
          cookies: { [USER_SESSION_ID_COOKIE]: 'c1' },
          headers: { [USER_SESSION_ID_HEADER]: 'h1' },
        }),
      ),
    ).toBe('c1');
  });

  it('is null with neither', () => {
    expect(currentSessionId(req({ headers: {} }))).toBeNull();
  });
});
