import {
  clearAdminSessionCookies,
  issueAdminSessionCookies,
} from './admin-auth-cookies';

/**
 * The admin portal's "CSRF validation failed" errors.
 *
 * Root cause: the double-submit pattern needs the frontend to read the CSRF
 * cookie and echo it in a header, and `document.cookie` can only do that when
 * the app and the API share a site. They do on localhost — cookies ignore
 * ports, so it worked in development — and they do NOT in production, where the
 * admin app is on Vercel and the API on its own domain. The header went out
 * empty, so every mutation behind `AdminJwtGuard` was refused while the
 * unguarded auth routes (login, verify, refresh) kept working. That is exactly
 * the pattern that was reported: Suspend broken, Help & Support broken, signing
 * in fine.
 *
 * The fix returns the token in the response body as well. These tests hold the
 * two halves that make that correct: the body value must be the SAME token the
 * cookie holds (the guard compares header against cookie), and the session
 * cookies must stay HttpOnly while the CSRF one does not.
 */
describe('admin session cookies', () => {
  let res: any;
  let cookies: Record<string, { value: string; options: any }>;
  let cleared: string[];

  beforeEach(() => {
    cookies = {};
    cleared = [];
    res = {
      cookie: jest.fn((name: string, value: string, options: any) => {
        cookies[name] = { value, options };
      }),
      clearCookie: jest.fn((name: string) => cleared.push(name)),
    };
  });

  it('returns the very token it wrote to the cookie', () => {
    // If these ever diverged, every mutation would fail just as surely as
    // sending no header at all — the guard compares one against the other.
    const { csrfToken } = issueAdminSessionCookies(res, 'access', 'refresh');
    expect(cookies.admin_csrf.value).toBe(csrfToken);
  });

  it('mints a high-entropy token, not a guessable one', () => {
    const { csrfToken } = issueAdminSessionCookies(res, 'access', 'refresh');
    expect(csrfToken).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex
  });

  it('rotates the token on every issuance', () => {
    // A refresh re-issues these, so a client that cached the previous value
    // would start failing the moment its session refreshed in the background.
    const first = issueAdminSessionCookies(res, 'a1', 'r1').csrfToken;
    const second = issueAdminSessionCookies(res, 'a2', 'r2').csrfToken;
    expect(second).not.toBe(first);
    expect(cookies.admin_csrf.value).toBe(second);
  });

  it('keeps the session cookies HttpOnly and the CSRF cookie readable', () => {
    // Making the CSRF cookie HttpOnly would look like hardening and would break
    // the same-site and local-development paths that still read it directly.
    issueAdminSessionCookies(res, 'access', 'refresh');
    expect(cookies.admin_access.options.httpOnly).toBe(true);
    expect(cookies.admin_refresh.options.httpOnly).toBe(true);
    expect(cookies.admin_csrf.options.httpOnly).toBe(false);
  });

  it('gives the CSRF cookie the access token’s lifetime, not the refresh one’s', () => {
    // It is rotated with the access token; outliving it would leave a value the
    // server has already replaced.
    issueAdminSessionCookies(res, 'access', 'refresh');
    expect(cookies.admin_csrf.options.maxAge).toBe(
      cookies.admin_access.options.maxAge,
    );
    expect(cookies.admin_csrf.options.maxAge).not.toBe(
      cookies.admin_refresh.options.maxAge,
    );
  });

  it('applies the same domain/path/sameSite to all three', () => {
    // A mismatch here means the browser treats them as different cookies and
    // `clearCookie` silently fails to remove one on sign-out.
    issueAdminSessionCookies(res, 'access', 'refresh');
    const shape = (o: any) => ({
      domain: o.domain,
      path: o.path,
      sameSite: o.sameSite,
      secure: o.secure,
    });
    expect(shape(cookies.admin_csrf.options)).toEqual(
      shape(cookies.admin_access.options),
    );
    expect(shape(cookies.admin_refresh.options)).toEqual(
      shape(cookies.admin_access.options),
    );
  });

  it('clears all three on sign-out', () => {
    clearAdminSessionCookies(res);
    expect(cleared.sort()).toEqual([
      'admin_access',
      'admin_csrf',
      'admin_refresh',
    ]);
  });
});
