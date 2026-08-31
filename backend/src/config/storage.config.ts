import { DEPLOYED_ENVIRONMENTS, int, oneOf, str, url } from './env';

/**
 * Object-storage and media configuration.
 *
 * Bucket names, public base URLs and the provider itself are all environment
 * values — a development bucket and a production bucket differ only here.
 */

/**
 * Cloudflare R2 is the only storage backend.
 *
 * The `supabase` and `local` options were removed: `local` was declared but
 * never implemented, and Supabase Storage held exactly one live object
 * (`email-assets/wordmark.png`), which has been migrated to R2. Keeping
 * STORAGE_PROVIDER as a validated single-value knob means a deployment that
 * still sets `supabase` fails loudly at boot rather than silently resolving
 * media against a bucket that no longer exists.
 */
const provider = oneOf('STORAGE_PROVIDER', ['r2'] as const, {
  default: 'r2',
});

export const storageConfigValues = {
  provider,

  /** Public base URL media is served from (CDN or bucket public host). */
  publicUrl: url('STORAGE_PUBLIC_URL') || url('R2_PUBLIC_URL'),

  r2: {
    accountId: str('R2_ACCOUNT_ID', { requiredIn: [] }),
    accessKeyId: str('R2_ACCESS_KEY_ID'),
    secretAccessKey: str('R2_SECRET_ACCESS_KEY'),
    /**
     * Bucket the environment reads and writes.
     *
     * The `meetifyy-dev` fallback applies ONLY outside staging/production. A
     * deployed environment must name its own bucket explicitly: an unset
     * R2_BUCKET_NAME in production previously fell through to the development
     * bucket, so production uploads (avatars, covers, event images) landed in
     * dev storage and dev could overwrite them. `requiredIn` turns that silent
     * cross-environment write into a boot failure.
     */
    bucketName: str('R2_BUCKET_NAME', {
      requiredIn: DEPLOYED_ENVIRONMENTS,
      default: 'meetifyy-dev',
    }),
    /**
     * Optional separate bucket for identity documents.
     *
     * The main bucket is served by a public `pub-*.r2.dev` host, which resolves
     * ANY key with no authentication — so for verification media, privacy there
     * rests entirely on the key being unguessable. That is not an acceptable
     * control for a government or college ID. Point this at a bucket with no
     * public host and verification objects become reachable only through a
     * signed URL.
     *
     * Unset falls back to `bucketName`, which keeps existing deployments
     * working unchanged.
     */
    verificationBucketName: str('R2_VERIFICATION_BUCKET_NAME', { default: '' }),
    publicUrl: url('R2_PUBLIC_URL'),
    region: str('STORAGE_REGION', { default: 'auto' }),
    /** Presigned URL lifetime in seconds. */
    signedUrlTtlSeconds: int('STORAGE_SIGNED_URL_TTL', {
      default: '3600',
      min: 60,
      max: 604800,
    }),
  },

  /** Branding assets referenced from emails and other server-rendered surfaces. */
  assets: {
    wordmarkUrl: url('WORDMARK_URL'),
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
