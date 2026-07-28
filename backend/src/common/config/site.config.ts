/**
 * Centralized Site & Branding Configuration
 *
 * Update FRONTEND_URL or LOGO_URL in environment variables (.env) to instantly
 * switch URLs across all emails, links, and services.
 */
export const SITE_CONFIG = {
  get frontendUrl(): string {
    const raw = process.env.FRONTEND_URL || 'https://meetify-web.vercel.app';
    return raw.replace(/\/$/, '');
  },
  get logoUrl(): string {
    return process.env.LOGO_URL || `${this.frontendUrl}/logo-512.png`;
  },
  get appName(): string {
    return process.env.APP_NAME || 'Meetifyy';
  },
  get dashboardUrl(): string {
    return `${this.frontendUrl}/home`;
  },
  get privacyUrl(): string {
    return `${this.frontendUrl}/privacy-policy`;
  },
  get termsUrl(): string {
    return `${this.frontendUrl}/terms-and-conditions`;
  },
  get resetPasswordUrl(): string {
    return `${this.frontendUrl}/reset-password`;
  },
  get passwordResetExpiryMinutes(): number {
    return 10;
  },
  get otpExpiryMinutes(): number {
    return 10;
  },
};
