import { int, oneOf, str, url } from './env';

/**
 * Object-storage and media configuration.
 *
 * Bucket names, public base URLs and the provider itself are all environment
 * values — a development bucket and a production bucket differ only here.
 */

const provider = oneOf('STORAGE_PROVIDER', ['r2', 'supabase', 'local'] as const, { default: 'r2' });

export const storageConfigValues = {
  provider,

  /** Public base URL media is served from (CDN or bucket public host). */
  publicUrl: url('STORAGE_PUBLIC_URL') || url('R2_PUBLIC_URL'),

  r2: {
    accountId: str('R2_ACCOUNT_ID', { requiredIn: [] }),
    accessKeyId: str('R2_ACCESS_KEY_ID'),
    secretAccessKey: str('R2_SECRET_ACCESS_KEY'),
    bucketName: str('R2_BUCKET_NAME', { default: 'meetifyy-dev' }),
    publicUrl: url('R2_PUBLIC_URL'),
    region: str('STORAGE_REGION', { default: 'auto' }),
    /** Presigned URL lifetime in seconds. */
    signedUrlTtlSeconds: int('STORAGE_SIGNED_URL_TTL', { default: '3600', min: 60, max: 604800 }),
  },

  /** Branding assets referenced from emails and other server-rendered surfaces. */
  assets: {
    logoUrl: url('LOGO_URL'),
    logoIconUrl: url('LOGO_ICON_URL'),
    logoWhiteUrl: url('LOGO_WHITE_URL'),
    iconInstagramUrl: url('ICON_INSTAGRAM_URL'),
    iconLinkedinUrl: url('ICON_LINKEDIN_URL'),
    iconWebsiteUrl: url('ICON_WEBSITE_URL'),
    iconShieldUrl: url('ICON_SHIELD_URL'),
  },
};

export type StorageConfig = typeof storageConfigValues;
