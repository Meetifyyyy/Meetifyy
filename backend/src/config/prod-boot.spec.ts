/**
 * Mirrors the exact variable set `setup-azure-prod.sh` provisions onto the
 * production Container App, so a change to the config layer that would break a
 * real production boot fails here instead of in Azure.
 */
describe('production container app configuration', () => {
  const PROD_ENV: Record<string, string> = {
    APP_ENV: 'production',
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '4000',
    APP_NAME: 'Meetifyy',
    FRONTEND_URL: 'https://meetifyy.app',
    BACKEND_URL: 'https://api.meetifyy.app',
    ADMIN_URL: 'https://admin.meetifyy.app',
    CORS_ORIGINS: 'https://meetifyy.app,https://www.meetifyy.app',
    // Not provisioned, and pinned empty rather than omitted: env.ts fills an
    // unset variable from the dotenv files on disk, and a developer's real
    // .env.production would otherwise decide this test's outcome.
    CORS_ORIGIN_PATTERNS: '',
    COOKIE_DOMAIN: '.meetifyy.app',
    COOKIE_SECURE: 'true',
    COOKIE_SAME_SITE: 'strict',
    EMAIL_DRIVER: 'resend',
    EMAIL_FROM: 'noreply@meetifyy.app',
    STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: 'acct',
    R2_BUCKET_NAME: 'meetifyy-prod',
    R2_ACCESS_KEY_ID: 'k',
    R2_SECRET_ACCESS_KEY: 's',
    REDIS_QUEUE_PREFIX: 'bull:production',
    DATABASE_URL: 'postgresql://u:p@prod.pooler.supabase.com:6543/postgres',
    DIRECT_URL: 'postgresql://u:p@prod.supabase.com:5432/postgres',
    REDIS_URL: 'rediss://:k@meetifyy-prod.redis.cache.windows.net:6380',
    SUPABASE_URL: 'https://prodref.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    ADMIN_JWT_ACCESS_SECRET: 'a',
    ADMIN_JWT_REFRESH_SECRET: 'r',
    ADMIN_JWT_PENDING_SECRET: 'p',
    RESEND_API_KEY: 'rk',
  };

  /**
   * Re-imports the config layer with a fresh `process.env`. Every slice is
   * built and validated at import time, so each case needs a clean registry.
   */
  const boot = (over: Record<string, string> = {}) => {
    jest.resetModules();
    process.env = { ...PROD_ENV, ...over };
    return () =>
      jest.requireActual<typeof import('./config')>('./config').config;
  };

  it('boots with exactly the variables setup-azure-prod.sh provisions', () => {
    expect(boot()).not.toThrow();
  });

  it('resolves media against the R2 bucket', () => {
    const cfg = boot()();
    expect(cfg.storage.provider).toBe('r2');
    expect(cfg.storage.r2.bucketName).toBe('meetifyy-prod');
  });

  /**
   * The installed app runs on `https://localhost` (capacitor.config.json). The
   * production API has never been configured with NATIVE_APP_ORIGINS, so this
   * pins that the built-in default is what lets the app in — no variable to
   * set at release — while the LAN allowance that also covers localhost stays
   * off, and the isolation guard accepts the result.
   */
  it('accepts the installed app with no extra variable, and nothing else local', () => {
    const cfg = boot()();
    expect(PROD_ENV.NATIVE_APP_ORIGINS).toBeUndefined();
    expect(cfg.app.cors.nativeAppOrigins).toEqual(['https://localhost']);
    expect(cfg.app.cors.origins).toEqual(
      expect.arrayContaining([
        'https://meetifyy.app',
        'https://www.meetifyy.app',
        'https://admin.meetifyy.app',
        'https://localhost',
      ]),
    );
    expect(cfg.app.cors.origins).toHaveLength(4);
    expect(cfg.app.cors.originPatterns).toEqual([]);
    expect(cfg.app.cors.allowLocalNetwork).toBe(false);
  });

  it('refuses to boot if a deployment still asks for the supabase provider', () => {
    expect(boot({ STORAGE_PROVIDER: 'supabase' })).toThrow(/STORAGE_PROVIDER/);
  });

  it('refuses to boot production against the dev bucket', () => {
    expect(boot({ R2_BUCKET_NAME: 'meetifyy-dev' })).toThrow(/isolation/i);
  });

  it('refuses to boot production against the dev redis', () => {
    expect(
      boot({
        REDIS_URL: 'rediss://:k@meetifyy-dev.redis.cache.windows.net:6380',
      }),
    ).toThrow(/isolation/i);
  });
});
