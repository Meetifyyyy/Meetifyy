import { IS_PRODUCTION, email, int, invariant, oneOf, str } from './env';
import { appConfigValues } from './app.config';

/**
 * Email delivery configuration.
 *
 * The sending logic is identical in every environment: development posts to a
 * local Mailpit over SMTP, production posts to Resend. Which one runs, who the
 * mail is from, and what URL the links inside it point at are all environment
 * values.
 */

const driver = oneOf('EMAIL_DRIVER', ['mailpit', 'smtp', 'resend'] as const, {
  default: IS_PRODUCTION ? 'resend' : 'mailpit',
});

const fromEmail = email('EMAIL_FROM', { requiredIn: ['staging', 'production'] }) || str('RESEND_FROM_EMAIL');
const fromName = str('EMAIL_FROM_NAME', { default: appConfigValues.name });
const smtpPort = int('SMTP_PORT', { default: '1025', min: 1, max: 65535 });

// A production deploy still pointed at Mailpit would queue mail into a local
// SMTP port that does not exist there and drop every message silently.
invariant(!IS_PRODUCTION || driver !== 'mailpit', 'Invalid EMAIL_DRIVER: "mailpit" cannot be used in production');
invariant(
  driver !== 'resend' || !!str('RESEND_API_KEY'),
  'Missing required environment variable: RESEND_API_KEY (required when EMAIL_DRIVER=resend)',
);

export const emailConfigValues = {
  driver,

  /** Default From header, assembled as `Name <address>`. */
  from: fromEmail && !fromEmail.includes('<') ? `${fromName} <${fromEmail}>` : fromEmail,
  fromEmail,
  fromName,
  replyTo: str('EMAIL_REPLY_TO') || undefined,

  /** From header for security-sensitive mail (admin OTP, password changes). */
  securityFrom: str('EMAIL_SECURITY_FROM') || (fromEmail ? `${fromName} Security <${fromEmail}>` : ''),

  /**
   * Development-only safety valve: when set, every outgoing message is
   * redirected here instead of the real recipient. Ignored in production.
   */
  devRedirectTo: IS_PRODUCTION ? '' : str('DEV_EMAIL_REDIRECT'),

  smtp: {
    host: str('SMTP_HOST', { default: '127.0.0.1' }),
    port: smtpPort,
    secure: smtpPort === 465,
    user: str('SMTP_USER') || undefined,
    pass: str('SMTP_PASS') || undefined,
  },

  resend: {
    apiKey: str('RESEND_API_KEY'),
  },
};

export type EmailConfig = typeof emailConfigValues;
