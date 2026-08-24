import { int, str, url } from './env';
import { appConfigValues } from './app.config';
import { storageConfigValues } from './storage.config';
import { authConfigValues } from './auth.config';

/**
 * Branding, public site links and marketing URLs used by emails, notifications
 * and server-rendered surfaces.
 *
 * Every value derives from FRONTEND_URL or an explicit environment variable —
 * nothing here is tied to a particular deployment.
 */

const frontendUrl = appConfigValues.frontendUrl;
const assets = storageConfigValues.assets;

export const siteConfigValues = {
  appName: appConfigValues.name,
  frontendUrl,

  /** Logos fall back to assets served by the frontend itself when unset. */
  logoUrl: assets.logoUrl || `${frontendUrl}/meetifyy_wordmark.png`,
  logoIconUrl: assets.logoIconUrl || `${frontendUrl}/logo.png`,
  logoWhiteUrl: assets.logoWhiteUrl || `${frontendUrl}/meetifyy_wordmark_white.png`,
  iconInstagramUrl: assets.iconInstagramUrl,
  iconLinkedinUrl: assets.iconLinkedinUrl,
  iconWebsiteUrl: assets.iconWebsiteUrl,
  iconShieldUrl: assets.iconShieldUrl,

  dashboardUrl: authConfigValues.redirects.dashboardUrl,
  resetPasswordUrl: authConfigValues.redirects.resetPasswordUrl,
  verifyEmailUrl: authConfigValues.redirects.verifyEmailUrl,
  privacyUrl: `${frontendUrl}${str('PRIVACY_PATH', { default: '/privacy-policy' })}`,
  termsUrl: `${frontendUrl}${str('TERMS_PATH', { default: '/terms-and-conditions' })}`,
  supportEmail: str('SUPPORT_EMAIL', { default: '' }),

  instagramUrl: url('INSTAGRAM_URL'),
  twitterUrl: url('TWITTER_URL'),
  linkedinUrl: url('LINKEDIN_URL'),

  passwordResetExpiryMinutes: int('PASSWORD_RESET_EXPIRY_MINUTES', { default: '10', min: 1 }),
  otpExpiryMinutes: int('OTP_EXPIRY_MINUTES', { default: '10', min: 1 }),
};

export type SiteConfig = typeof siteConfigValues;

/**
 * Legacy alias kept for the email templates, which read branding values through
 * `SITE_CONFIG.*`. Identical object — new code should use `config.site`.
 */
export const SITE_CONFIG = siteConfigValues;
