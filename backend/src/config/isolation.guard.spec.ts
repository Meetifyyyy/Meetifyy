describe('environment isolation guard', () => {
  const base = {
    APP_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@prod-db.example.com/meetifyy',
    DIRECT_URL: 'postgresql://u:p@prod-db.example.com/meetifyy',
    REDIS_URL:
      'rediss://:secret@meetifyy-prod-redis.redis.cache.windows.net:6380',
    REDIS_HOST: 'meetifyy-prod-redis.redis.cache.windows.net',
    SUPABASE_URL: 'https://prodproject.supabase.co',
    SUPABASE_ANON_KEY: 'x',
    SUPABASE_SERVICE_ROLE_KEY: 'x',
    R2_BUCKET_NAME: 'meetifyy-prod',
    FRONTEND_URL: 'https://meetifyy.app',
    ADMIN_URL: 'https://admin.meetifyy.app',
    ADMIN_JWT_ACCESS_SECRET: 'x',
    ADMIN_JWT_REFRESH_SECRET: 'x',
  } as Record<string, string>;

  /**
   * Re-imports the guard with a fresh `process.env`. The module reads its
   * configuration at import time, so each case needs a clean module registry.
   */
  const load = (over: Record<string, string> = {}) => {
    jest.resetModules();
    process.env = { ...base, ...over };
    const mod =
      jest.requireActual<typeof import('./isolation.guard')>(
        './isolation.guard',
      );
    return () => mod.assertEnvironmentIsolation();
  };

  it('passes when every resource is production-named', () => {
    expect(load()).not.toThrow();
  });

  it('rejects a production boot against the DEV redis', () => {
    expect(
      load({
        REDIS_URL:
          'rediss://:secret@meetifyy-dev-redis.redis.cache.windows.net:6380',
        REDIS_HOST: 'meetifyy-dev-redis.redis.cache.windows.net',
      }),
    ).toThrow(/REDIS_URL/);
  });

  it('rejects a production boot against the DEV bucket', () => {
    expect(load({ R2_BUCKET_NAME: 'meetifyy-dev' })).toThrow(/R2_BUCKET_NAME/);
  });

  it('never echoes credentials from a connection string', () => {
    const run = load({
      DATABASE_URL: 'postgresql://user:SUPERSECRET@dev-db.example.com/x',
    });
    expect(run).toThrow(/isolation/i);

    let message = '';
    try {
      run();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('dev-db.example.com');
    expect(message).not.toContain('SUPERSECRET');
  });

  it('rejects a wildcard CORS origin', () => {
    expect(load({ CORS_ORIGINS: 'https://meetifyy.app,*' })).toThrow(/CORS/);
  });
});
