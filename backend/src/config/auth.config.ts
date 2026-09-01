import {
  ALL_ENVIRONMENTS,
  IS_PRODUCTION,
  bool,
  invariant,
  oneOf,
  str,
  url,
} from './env';
import { appConfigValues } from './app.config';

/**
 * Authentication, session-cookie and redirect configuration.
 *
 * Every URL a user is sent back to after an auth action is derived from
 * FRONTEND_URL plus a configurable path, so a new domain needs no code change.
 */

const frontendUrl = appConfigValues.frontendUrl;

const path = (name: string, fallback: string): string => {
  const value = str(name, { default: fallback });
  return value.startsWith('/') ? value : `/${value}`;
};

const sameSite = oneOf('COOKIE_SAME_SITE', ['strict', 'lax', 'none'] as const, {
  default: 'strict',
});
const secure = bool('COOKIE_SECURE', { default: String(IS_PRODUCTION) });

// SameSite=None is ignored by browsers unless the cookie is also Secure; a
// cross-site admin deployment configured this way would silently lose its
// session on every request.
invariant(
  sameSite !== 'none' || secure,
  'Invalid COOKIE_SAME_SITE: "none" requires COOKIE_SECURE=true',
);
invariant(
  !IS_PRODUCTION || secure,
  'Invalid COOKIE_SECURE: must be true in production',
);

const authPaths = {
  callback: path('AUTH_CALLBACK_PATH', '/auth/callback'),
  login: path('AUTH_LOGIN_PATH', '/login'),
  signup: path('AUTH_SIGNUP_PATH', '/signup'),
  resetPassword: path('AUTH_RESET_PASSWORD_PATH', '/reset-password'),
  verifyEmail: path('AUTH_VERIFY_EMAIL_PATH', '/verify-email'),
  dashboard: path('AUTH_DASHBOARD_PATH', '/home'),
};

export const authConfigValues = {
  supabase: {
    url: url('SUPABASE_URL', { requiredIn: ALL_ENVIRONMENTS }),
    anonKey: str('SUPABASE_ANON_KEY', { requiredIn: ALL_ENVIRONMENTS }),
    serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY', {
      requiredIn: ['staging', 'production'],
    }),
    /**
     * Optional. When set, user JWT signatures are verified locally (HS256) with
     * zero network calls instead of one Supabase Auth request per token.
     */
    jwtSecret: str('SUPABASE_JWT_SECRET'),
  },

  /**
   * Keys the HMAC that protects stored one-time codes (account deletion and
   * recovery). A 6-digit code has only a million possibilities, so a plain
   * digest of it is reversible by anyone holding the table — keying the hash
   * with a server-side secret means a database leak alone does not yield the
   * codes.
   *
   * Falls back to the Supabase service-role key, which is already required in
   * staging and production, so this introduces no new mandatory variable and no
   * environment silently drops to an unkeyed hash. Set it explicitly to rotate
   * OTP hashing independently of that key.
   */
  otp: {
    hashSecret: str('OTP_HASH_SECRET'),
  },

  admin: {
    accessSecret: str('ADMIN_JWT_ACCESS_SECRET', {
      requiredIn: ['staging', 'production'],
    }),
    refreshSecret: str('ADMIN_JWT_REFRESH_SECRET', {
      requiredIn: ['staging', 'production'],
    }),
    pendingSecret: str('ADMIN_JWT_PENDING_SECRET', {
      requiredIn: ['staging', 'production'],
    }),
    superAdminEmail: str('SUPER_ADMIN_EMAIL'),
    superAdminPassword: str('SUPER_ADMIN_PASSWORD'),
  },

  cookie: {
    /** Empty means "host-only" — correct for localhost and single-domain deploys. */
    domain: str('COOKIE_DOMAIN') || undefined,
    secure,
    sameSite,
    path: '/',
    accessMaxAgeMs: 15 * 60 * 1000,
    refreshMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  },

  paths: authPaths,

  /** Absolute redirect targets built from FRONTEND_URL. */
  redirects: {
    callbackUrl: `${frontendUrl}${authPaths.callback}`,
    loginUrl: `${frontendUrl}${authPaths.login}`,
    signupUrl: `${frontendUrl}${authPaths.signup}`,
    resetPasswordUrl: `${frontendUrl}${authPaths.resetPassword}`,
    verifyEmailUrl: `${frontendUrl}${authPaths.verifyEmail}`,
    dashboardUrl: `${frontendUrl}${authPaths.dashboard}`,
  },
};

export type AuthConfig = typeof authConfigValues;
