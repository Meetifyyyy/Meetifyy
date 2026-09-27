jest.mock('../../config', () => ({
  config: {
    auth: {
      cookie: {
        domain: '.meetifyy.app',
        secure: true,
        sameSite: 'strict',
        path: '/',
      },
    },
  },
}));

import {
  clearUserSessionCookies,
  issueUserSessionCookies,
  USER_SESSION_ID_COOKIE,
} from './user-session-cookies';
import type { CookieOptions, Response } from 'express';
import { expect } from '@jest/globals';
import { stub } from '../../common/testing/stub';

function fakeResponse() {
  const calls: Array<{ op: string; name: string; opts: CookieOptions }> = [];
  return {
    calls,
    cookie: jest.fn((name: string, _v: string, opts: CookieOptions) =>
      calls.push({ op: 'set', name, opts }),
    ),
    clearCookie: jest.fn((name: string, opts: CookieOptions) =>
      calls.push({ op: 'clear', name, opts }),
    ),
  };
}

describe('session cookies with a configured Domain', () => {
  it('expires the host-only session id before issuing the Domain one', () => {
    const res = fakeResponse();
    issueUserSessionCookies(stub<Response>(res), 'a', 'r', 1000, 2000, 'sid');

    const sid = res.calls.filter((c) => c.name === USER_SESSION_ID_COOKIE);
    expect(sid).toEqual([
      expect.objectContaining({
        op: 'clear',
        opts: expect.objectContaining({ domain: undefined }),
      }),
      expect.objectContaining({
        op: 'set',
        opts: expect.objectContaining({ domain: '.meetifyy.app' }),
      }),
    ]);
  });

  it('clears both the host-only and the Domain variants on sign-out', () => {
    const res = fakeResponse();
    clearUserSessionCookies(stub<Response>(res));

    const domains = res.calls
      .filter((c) => c.name === USER_SESSION_ID_COOKIE)
      .map((c) => c.opts.domain);
    expect(domains).toEqual([undefined, '.meetifyy.app']);
    expect(res.calls.every((c) => c.op === 'clear')).toBe(true);
  });
});
