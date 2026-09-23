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
    // Pinned, because env.ts fills anything unset from the dotenv files on
    // disk — on a developer machine that includes a real .env.production, so
    // leaving these out made the result depend on whose machine ran it.
    CORS_ORIGINS: '',
    CORS_ORIGIN_PATTERNS: '',
    COOKIE_DOMAIN: '',
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

  /**
   * Development and production share `.meetifyy.app`. Both APIs were given
   * `https://*.meetifyy.app`, and development also listed production's apex —
   * so each answered the other environment's pages with credentialed
   * responses. These cases are the two live configurations as they were.
   */
  describe('CORS across environments that share a cookie domain', () => {
    const shared = { COOKIE_DOMAIN: '.meetifyy.app' };
    const prodOrigins = {
      ...shared,
      CORS_ORIGINS: 'https://meetifyy.app,https://www.meetifyy.app',
    };

    it('lets production answer its own pages and the installed app', () => {
      expect(load(prodOrigins)).not.toThrow();
    });

    it("refuses production's former pattern, which also matches dev hosts", () => {
      expect(
        load({
          ...prodOrigins,
          CORS_ORIGIN_PATTERNS: 'https://*.meetifyy.app',
        }),
      ).toThrow(
        /also matches "dev\.meetifyy\.app", "dev-admin\.meetifyy\.app"/,
      );
    });

    it('refuses a dev origin listed in production', () => {
      expect(
        load({
          ...shared,
          CORS_ORIGINS: 'https://meetifyy.app,https://dev.meetifyy.app',
        }),
      ).toThrow(/dev\.meetifyy\.app/);
    });

    describe('in development', () => {
      const dev = {
        ...shared,
        APP_ENV: 'development',
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@dev-db.example.com/meetifyy',
        DIRECT_URL: 'postgresql://u:p@dev-db.example.com/meetifyy',
        REDIS_URL:
          'rediss://:s@meetifyy-redis-dev.redis.cache.windows.net:6380',
        REDIS_HOST: 'meetifyy-redis-dev.redis.cache.windows.net',
        R2_BUCKET_NAME: 'meetifyy-dev',
        FRONTEND_URL: 'https://dev.meetifyy.app',
        ADMIN_URL: '',
      };

      it("refuses development's former configuration", () => {
        const run = load({
          ...dev,
          CORS_ORIGINS: 'https://dev.meetifyy.app,https://meetifyy.app',
          CORS_ORIGIN_PATTERNS: 'https://*.meetifyy.app',
        });
        expect(run).toThrow(/CORS allows "https:\/\/meetifyy\.app"/);
        expect(run).toThrow(
          /"https:\/\/\*\.meetifyy\.app" also matches .*"www\.meetifyy\.app"/,
        );
        expect(run).toThrow(/also matches .*"admin\.meetifyy\.app"/);
      });

      it('accepts its own frontend and admin, listed exactly', () => {
        expect(
          load({
            ...dev,
            CORS_ORIGINS:
              'https://dev.meetifyy.app,https://dev-admin.meetifyy.app',
            CORS_ORIGIN_PATTERNS: '',
          }),
        ).not.toThrow();
      });

      it('never inspects a host-only deployment, such as a developer machine', () => {
        expect(
          load({
            ...dev,
            COOKIE_DOMAIN: '',
            FRONTEND_URL: 'http://localhost:5173',
            CORS_ORIGINS: 'http://localhost:5173,https://meetifyy.app',
          }),
        ).not.toThrow();
      });
    });
  });
});
