import {
  IS_PRODUCTION,
  IS_STAGING,
  email,
  int,
  invariant,
  oneOf,
  str,
} from './env';
import { appConfigValues } from './app.config';

/**
 * Email delivery configuration.
 *
 * The sending logic is identical in every environment: development posts to a
 * local Mailpit over SMTP, production posts to Resend. Which one runs, who the
 * mail is from, and what URL the links inside it point at are all environment
 * values.
 */

const isDeployed = IS_PRODUCTION || IS_STAGING;

const driver = oneOf('EMAIL_DRIVER', ['mailpit', 'smtp', 'resend'] as const, {
  default: isDeployed ? 'resend' : 'mailpit',
});

// Optional SMTP fallback: when set, a failed primary send is retried once via
// SMTP before the job is marked failed. Empty string = no fallback (default).
// Only 'smtp' is supported as a fallback — mailpit is not a real relay and
// resend→resend failover is not meaningful.
const fallbackDriver = oneOf(
  'EMAIL_FALLBACK_DRIVER',
  ['', 'smtp'] as const,
  { default: '' },
);

const fromEmail =
  email('EMAIL_FROM', { requiredIn: ['staging', 'production'] }) ||
  str('RESEND_FROM_EMAIL') ||
  'noreply@meetifyy.app';
const fromName = str('EMAIL_FROM_NAME', { default: appConfigValues.name });
const smtpPort = int('SMTP_PORT', { default: '1025', min: 1, max: 65535 });

// A deployed environment still pointed at Mailpit would queue mail into a local
// SMTP port that does not exist there and drop every message silently.
invariant(
  !isDeployed || driver !== 'mailpit',
  'Invalid EMAIL_DRIVER: "mailpit" cannot be used in staging or production',
);
invariant(
  driver !== 'resend' || !!str('RESEND_API_KEY'),
  'Missing required environment variable: RESEND_API_KEY (required when EMAIL_DRIVER=resend)',
);
/*
 * A relay fallback is only useful if it can actually authenticate.
 *
 * Checked at boot rather than on first use, because the fallback runs at the
 * worst possible moment — the primary has already failed — and a transporter
 * built without credentials is rejected by every real relay (Brevo included).
 * Discovering that then means the email is lost twice over, with the second
 * failure buried in a retry log.
 */
invariant(
  fallbackDriver !== 'smtp' || !!str('SMTP_HOST'),
  'Missing required environment variable: SMTP_HOST (required when EMAIL_FALLBACK_DRIVER=smtp)',
);
invariant(
  fallbackDriver !== 'smtp' || !!str('SMTP_USER'),
  'Missing required environment variable: SMTP_USER (required when EMAIL_FALLBACK_DRIVER=smtp)',
);
invariant(
  fallbackDriver !== 'smtp' || !!str('SMTP_PASS'),
  'Missing required environment variable: SMTP_PASS (required when EMAIL_FALLBACK_DRIVER=smtp)',
);

/** The bare `user@host` part of the From header, with any `Name <...>` wrapper stripped. */
const senderAddress = fromEmail.includes('<')
  ? fromEmail.slice(fromEmail.indexOf('<') + 1, fromEmail.indexOf('>')).trim()
  : fromEmail.trim();

// Resend can only send from a domain verified on the account. Without an
// address there is nothing to verify and every send would 403. In staging and
// production EMAIL_FROM is already required above, so this only covers the
// case of a developer opting into the resend driver locally.
invariant(
  driver !== 'resend' || isDeployed || senderAddress.includes('@'),
  'Missing required environment variable: EMAIL_FROM (required when EMAIL_DRIVER=resend)',
);

export const emailConfigValues = {
  driver,
  fallbackDriver,

  /** Default From header, assembled as `Name <address>`. */
  from:
    fromEmail && !fromEmail.includes('<')
      ? `${fromName} <${fromEmail}>`
      : fromEmail,
  fromEmail,
  fromName,
  replyTo: str('EMAIL_REPLY_TO') || undefined,

  /** From header for security-sensitive mail (admin OTP, password changes). */
  securityFrom:
    str('EMAIL_SECURITY_FROM') ||
    (fromEmail ? `${fromName} Security <${fromEmail}>` : ''),

  /**
   * Development-only safety valve: when set, every outgoing message is
   * redirected here instead of the real recipient.
   *
   * Ignored in every deployed environment. It used to be disabled only under
   * IS_PRODUCTION, which left staging able to silently swallow every real
   * recipient into one developer inbox.
   */
  devRedirectTo: isDeployed ? '' : str('DEV_EMAIL_REDIRECT'),

  smtp: {
    host: str('SMTP_HOST', { default: '127.0.0.1' }),
    port: smtpPort,
    secure: smtpPort === 465,
    user: str('SMTP_USER') || undefined,
    pass: str('SMTP_PASS') || undefined,
  },

  resend: {
    apiKey: str('RESEND_API_KEY'),
    /**
     * Domain of the From address. Resend rejects (403) any send whose From
     * domain is not verified on the account, so this is checked once at boot
     * rather than discovered one bounced job at a time.
     */
    fromDomain: senderAddress.includes('@')
      ? senderAddress.split('@')[1].toLowerCase()
      : '',
  },
};

export type EmailConfig = typeof emailConfigValues;
