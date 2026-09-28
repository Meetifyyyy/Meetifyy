import type { CookieOptions, Request, Response } from 'express';

/**
 * Typed Express doubles for controller specs.
 *
 * Controllers take `Request` and `Response`; a spec that hands them an `any`
 * object compiles whatever the controller reads, so a renamed field or a
 * cookie read the wrong way still passes. These give the controller the real
 * types and give the test typed spies to assert on. The one cast from a
 * partial object to the full Express type lives here, not in every spec.
 */

/** A Response whose cookie methods are spies the test can inspect. */
export type MockResponse = Response & {
  cookie: jest.Mock<Response, [string, string, CookieOptions?]>;
  clearCookie: jest.Mock<Response, [string, CookieOptions?]>;
};

export function createMockResponse(): MockResponse {
  const res = {
    cookie: jest.fn<Response, [string, string, CookieOptions?]>(),
    clearCookie: jest.fn<Response, [string, CookieOptions?]>(),
  };
  res.cookie.mockReturnValue(res as unknown as Response);
  res.clearCookie.mockReturnValue(res as unknown as Response);
  return res as unknown as MockResponse;
}

/** The cookies a response set, as name → value (last write wins). */
export function cookiesSetOn(res: MockResponse): Record<string, string> {
  return Object.fromEntries(
    res.cookie.mock.calls.map(([name, value]) => [name, value]),
  );
}

/** The names of the cookies a response cleared, in order. */
export function cookiesClearedOn(res: MockResponse): string[] {
  return res.clearCookie.mock.calls.map(([name]) => name);
}

export interface MockRequestInit {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: unknown;
  method?: string;
  ip?: string;
}

/** A Request with the fields controllers read; everything else is absent. */
export function createMockRequest(init: MockRequestInit = {}): Request {
  return {
    method: init.method ?? 'GET',
    headers: { 'user-agent': 'jest', ...init.headers },
    cookies: init.cookies ?? {},
    body: init.body,
    ip: init.ip,
    socket: { remoteAddress: init.ip },
  } as unknown as Request;
}
