import { config } from '../config';

/**
 * The API origin, entirely from configuration.
 *
 * A page served from a developer machine or a LAN device talks to the backend
 * on that same host (so testing from another device on the same Wi-Fi works);
 * everywhere else the configured VITE_API_URL is used verbatim.
 */
const getBackendUrl = (): string => {
  const { baseUrl, localPort, preferLocalBackend } = config.api;

  if (preferLocalBackend && typeof window !== 'undefined' && window.location?.hostname) {
    const { hostname, protocol } = window.location;
    return `${protocol}//${hostname}:${localPort}`;
  }

  // Empty base URL means same-origin, which is what a single-domain deployment
  // (or the dev-server proxy) wants.
  return baseUrl;
};

const BASE_URL = getBackendUrl();

export { BASE_URL };

/**
 * Resolves a media reference into a URL this client can load.
 *
 * Handles the three shapes the API returns: an absolute URL, an API-relative
 * path, and an absolute URL carrying whichever backend origin wrote it (which
 * may not be the origin this client talks to).
 */
export function getMediaUrl(src?: string | null): string | null {
  if (!src) return null;
  const localOriginPattern = new RegExp(`^https?://(?:localhost|127\\.0\\.0\\.1):${config.api.localPort}`, 'i');
  if (localOriginPattern.test(src)) {
    return src.replace(localOriginPattern, BASE_URL);
  }
  if (src.startsWith('/')) return `${BASE_URL}${src}`;
  return src;
}

/** Single-flight guard — concurrent 401 retries share one refresh attempt. */
let refreshPromise: Promise<boolean> | null = null;

/**
 * Auth endpoints must NOT trigger the silent-refresh/redirect machinery. A 401
 * here means "bad credentials / wrong OTP / no session yet" — the caller shows
 * an inline error. Sending these through the refresh flow caused the login page
 * to hard-reload in a loop (the flicker) and destroyed the multi-step OTP state.
 */
const AUTH_NO_REFRESH_PATHS = [
  '/admin/auth/login',
  '/admin/auth/verify-otp',
  '/admin/auth/verify-totp',
  '/admin/auth/refresh',
  '/admin/auth/logout',
];

const shouldAttemptRefresh = (endpoint: string) =>
  !AUTH_NO_REFRESH_PATHS.some((p) => endpoint.includes(p));

/** Thrown when a session cannot be refreshed — lets callers/guards react in-app. */
export class SessionExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Registered by AuthContext. When a refresh fails we clear auth state here and
 * let React Router's guards redirect — no `window.location` hard reload, so the
 * SPA never flashes/loops.
 */
let sessionExpiredHandler: (() => void) | null = null;
export function onSessionExpired(handler: () => void) {
  sessionExpiredHandler = handler;
}
function notifySessionExpired() {
  if (sessionExpiredHandler) sessionExpiredHandler();
}

/**
 * The session's CSRF token, held in memory.
 *
 * Reading it from `document.cookie` is not enough, and was the cause of the
 * "CSRF validation failed" errors across the portal: the cookie is set by the
 * API's origin, so the admin app can only read it when the two share a site.
 * They do on localhost (cookies ignore ports) and they do NOT in production,
 * where this app is on Vercel and the API on its own domain. The header went
 * out empty, and every mutation behind `AdminJwtGuard` was refused while the
 * unguarded auth routes kept working.
 *
 * The API now returns the token in the body of the routes that mint it. In
 * memory rather than `localStorage` on purpose: it should not outlive the tab,
 * and a token sitting in storage is one XSS away from being exfiltrated for
 * later use. A reload re-seeds it from `/admin/auth/me`.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  if (typeof token === 'string' && token.length > 0) csrfToken = token;
}

export function clearCsrfToken(): void {
  csrfToken = null;
}

/** The cookie, when this deployment happens to be same-site. */
function readCsrfCookie(): string | null {
  const match = document.cookie.match(new RegExp('(^| )admin_csrf=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Memory first, cookie second.
 *
 * The cookie is kept as a fallback rather than removed so a same-site or
 * proxied deployment — and local development — keeps working unchanged, and so
 * a tab that has not yet completed its `me` call is not left without a token.
 */
function currentCsrfToken(): string | null {
  return csrfToken ?? readCsrfCookie();
}

/**
 * Re-seeds the token from the session itself.
 *
 * Used on boot, and once as a recovery step when a mutation is refused for
 * CSRF — which is what a reloaded tab or a token rotated by a concurrent
 * refresh looks like from here.
 */
export async function refreshCsrfToken(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/admin/auth/me`, {
      credentials: 'include',
    });
    if (!res.ok) return false;
    const body = await res.json();
    setCsrfToken(body?.csrfToken);
    return Boolean(body?.csrfToken);
  } catch {
    return false;
  }
}

function isMutation(options: RequestInit): boolean {
  const method = (options.method || 'GET').toUpperCase();
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}

function buildHeaders(options: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (isMutation(options)) {
    const token = currentCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }
  return headers;
}

async function parseError(response: Response): Promise<string> {
  const errData = await response.json().catch(() => ({}));
  return errData.message || `HTTP ${response.status} error`;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  csrfRetried = false,
): Promise<T> {
  const url = `${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const response = await fetch(url, {
    ...options,
    headers: buildHeaders(options),
    credentials: 'include', // HttpOnly cookies (admin_access, admin_refresh, admin_csrf)
  });

  // Happy path
  if (response.ok) return response.json();

  // 403 on a mutation → the token is stale or was never seeded (a reloaded tab,
  // or a concurrent refresh that rotated it). Re-seed from the session and
  // retry exactly once. Guarded by `csrfRetried` so a genuine authorization
  // failure cannot turn into a loop, and never applied to GETs, which the
  // server does not CSRF-check at all.
  if (response.status === 403 && isMutation(options) && !csrfRetried) {
    const message = await parseError(response);
    if (/csrf/i.test(message)) {
      const reseeded = await refreshCsrfToken();
      if (reseeded) {
        return apiRequest<T>(endpoint, options, true);
      }
    }
    throw new Error(message);
  }

  // 401 on an auth endpoint → surface the message, never refresh/redirect.
  if (response.status === 401 && !shouldAttemptRefresh(endpoint)) {
    throw new Error(await parseError(response));
  }

  // 401 elsewhere → attempt a single shared refresh, then retry once.
  if (response.status === 401) {
    if (!refreshPromise) {
      refreshPromise = fetch(`${BASE_URL}/admin/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
        .then(async (r) => {
          if (!r.ok) return false;
          // A refresh rotates the CSRF token along with the access token, so
          // the retry below must carry the NEW one — the old value stops
          // matching the cookie the instant that response is written.
          const body = await r.json().catch(() => null);
          setCsrfToken(body?.csrfToken);
          return true;
        })
        .catch(() => false)
        .finally(() => { refreshPromise = null; });
    }

    const refreshed = await refreshPromise;

    if (refreshed) {
      const retryRes = await fetch(url, {
        ...options,
        headers: buildHeaders(options),
        credentials: 'include',
      });
      if (retryRes.ok) return retryRes.json();
      if (retryRes.status === 401) {
        notifySessionExpired();
        throw new SessionExpiredError();
      }
      throw new Error(await parseError(retryRes));
    }

    // Refresh failed → clear auth state in-app (guards redirect); no hard reload.
    notifySessionExpired();
    throw new SessionExpiredError();
  }

  throw new Error(await parseError(response));
}
