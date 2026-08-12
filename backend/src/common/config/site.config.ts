/**
 * Centralized Site & Branding Configuration
 *
 * Update FRONTEND_URL or LOGO_URL in environment variables (.env) to instantly
 * switch URLs across all emails, links, and services.
 */
export const SITE_CONFIG = {
  get frontendUrl(): string {
    const raw = process.env.FRONTEND_URL || 'https://dev.meetifyy.app';
    return raw.replace(/\/$/, '');
  },
  get logoUrl(): string {
    return process.env.LOGO_URL || 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/email-assets/meetifyy_wordmark_dark.png';
  },
  get logoWhiteUrl(): string {
    return process.env.LOGO_WHITE_URL || 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/email-assets/meetifyy_wordmark_white.png';
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
  get instagramUrl(): string {
    return process.env.INSTAGRAM_URL || 'https://instagram.com/meetifyy';
  },
  get twitterUrl(): string {
    return process.env.TWITTER_URL || 'https://x.com/meetifyy';
  },
  get linkedinUrl(): string {
    return process.env.LINKEDIN_URL || 'https://linkedin.com/company/meetifyy';
  },
  get iconInstagramUrl(): string {
    return process.env.ICON_INSTAGRAM_URL || 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/email-assets/user_instagram.png';
  },
  get iconLinkedinUrl(): string {
    return process.env.ICON_LINKEDIN_URL || 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/email-assets/user_linkedin.png';
  },
  get iconWebsiteUrl(): string {
    return process.env.ICON_WEBSITE_URL || 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/email-assets/user_website.png';
  },
  get iconShieldUrl(): string {
    return process.env.ICON_SHIELD_URL || 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev/email-assets/icon_shield.png';
  },
};
