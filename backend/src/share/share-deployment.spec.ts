/**
 * The share pipeline must describe the deployment it is running in.
 *
 * A development build has to advertise the development site and the development
 * API; a production build has to advertise production. Nothing in this feature
 * may name a host or a brand it was written against, because the failure is
 * silent and outward-facing: a card that says `meetifyy.app` under a link to
 * `dev.meetifyy.app`, or an `og:image` pointing at an API that has never heard
 * of the post.
 *
 * Every value below is re-read through a fresh module registry per case, which
 * is the only way to test configuration that is resolved once at import.
 */
describe('share metadata follows the deployment', () => {
  const ENV_KEYS = [
    'APP_ENV',
    'NODE_ENV',
    'APP_NAME',
    'FRONTEND_URL',
    'BACKEND_URL',
    'API_BASE_URL',
    'DATABASE_URL',
  ] as const;

  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.resetModules();
  });

  /** Loads the share modules fresh against one environment's variables. */
  const loadAs = (env: Record<string, string>) => {
    jest.resetModules();
    process.env.APP_ENV = 'development';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/db';
    Object.assign(process.env, env);

    const doc =
      require('./share-document') as typeof import('./share-document');

    const svc =
      require('./share-preview.service') as typeof import('./share-preview.service');

    const fixture =
      require('./testing/share-post.fixture') as typeof import('./testing/share-post.fixture');
    return { doc, svc, fixture };
  };

  const DEV = {
    APP_NAME: 'Meetifyy',
    FRONTEND_URL: 'https://dev.meetifyy.app',
    BACKEND_URL: 'https://dev-api.meetifyy.app',
  };

  const PROD = {
    APP_NAME: 'Meetifyy',
    FRONTEND_URL: 'https://meetifyy.app',
    BACKEND_URL: 'https://api.meetifyy.app',
  };

  it('points the canonical URL at this deployment’s own site', () => {
    const dev = loadAs(DEV);
    expect(dev.doc.canonicalPostUrl('p1')).toBe(
      'https://dev.meetifyy.app/post/p1',
    );

    const prod = loadAs(PROD);
    expect(prod.doc.canonicalPostUrl('p1')).toBe(
      'https://meetifyy.app/post/p1',
    );
  });

  it('points the card image at this deployment’s own API', () => {
    // Not the frontend origin, and not a host named in vercel.json: the API
    // knows its own address, and a routing rule in another file does not have
    // to be kept in step with it.
    const post = loadAs(DEV).fixture.sharePost();

    expect(loadAs(DEV).doc.shareImageUrl(post)).toContain(
      'https://dev-api.meetifyy.app/api/share/post/',
    );
    expect(loadAs(PROD).doc.shareImageUrl(post)).toContain(
      'https://api.meetifyy.app/api/share/post/',
    );
  });

  it('never leaks the production host into a development document', () => {
    const { doc, fixture } = loadAs(DEV);
    const html = doc.renderShareDocument(fixture.sharePost());

    // The exact failure this guards: a development deployment publishing a card
    // whose every link goes to production, which is both wrong and a way to
    // send real users at half-finished work.
    expect(html).not.toMatch(/https:\/\/meetifyy\.app/);
    expect(html).not.toMatch(/https:\/\/api\.meetifyy\.app/);
    expect(html).toContain('https://dev.meetifyy.app/post/');
    expect(html).toContain('https://dev-api.meetifyy.app/api/share/post/');
  });

  it('calls the product whatever this deployment calls it', () => {
    const { svc, fixture } = loadAs({ ...DEV, APP_NAME: 'Campusly' });
    const post = fixture.sharePost();

    expect(svc.SharePreviewService.title(post)).toContain('on Campusly');
    expect(
      svc.SharePreviewService.description(fixture.sharePost({ text: '' })),
    ).toContain('Campusly');
  });

  it('resolves the site and the API independently', () => {
    // A deployment may serve its API from anywhere — a different domain, a
    // different provider — and the two are not derived from one another.
    const { doc, fixture } = loadAs({
      APP_NAME: 'Meetifyy',
      FRONTEND_URL: 'https://app.example.test',
      BACKEND_URL: 'https://edge.example.net',
    });

    expect(doc.canonicalPostUrl('p1')).toBe('https://app.example.test/post/p1');
    expect(doc.shareImageUrl(fixture.sharePost())).toContain(
      'https://edge.example.net/api/share/post/',
    );
  });

  it('falls back to the site origin when no API URL is configured', () => {
    // Local development: BACKEND_URL is usually unset and Vite proxies `/api`,
    // so the frontend origin is the address that actually reaches the backend.
    const { doc, fixture } = loadAs({
      APP_NAME: 'Meetifyy',
      FRONTEND_URL: 'http://localhost:5178',
      BACKEND_URL: '',
      API_BASE_URL: '',
    });

    expect(doc.shareImageUrl(fixture.sharePost())).toContain(
      'http://localhost:5178/api/share/post/',
    );
  });
});
