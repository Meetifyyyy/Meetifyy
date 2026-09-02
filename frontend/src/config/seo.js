/**
 * The one description of what this site looks like in a search result.
 *
 * Three very different consumers read this table, and they must not be allowed
 * to disagree:
 *
 *   1. `scripts/prerender-seo.mjs` bakes it into real HTML files at build time,
 *      which is the only copy non-JavaScript crawlers ever see. Twitterbot,
 *      facebookexternalhit, Slackbot and WhatsApp do not run scripts at all, so
 *      a link preview is decided entirely by what this table produced.
 *   2. `scripts/generate-sitemap.mjs` reads it to decide what to submit.
 *   3. `shared/hooks/usePageMetadata` replays it on client-side navigation,
 *      because a SPA route change never fetches a new document.
 *
 * It is deliberately free of `import.meta.env`, DOM access and every project
 * alias, so a plain `node` build script can import it unchanged.
 *
 * COPY RULES, which are load-bearing rather than stylistic:
 *   - No em dashes, en dashes or other typographic punctuation. Search engines
 *     render these verbatim and they read as machine-written.
 *   - At most one `|`, and only to separate a page name from the brand.
 *   - Descriptions target 110 to 160 characters. Below that Google pads the
 *     snippet from page text; above it, the tail is truncated.
 *   - Every description is written for its own page. Duplicated descriptions
 *     across URLs are the single most common cause of Search Console's
 *     "Duplicate without user-selected canonical".
 */

/**
 * The only hostnames a build is ever allowed to publish as indexable.
 *
 * This is the last line of defence against the single worst failure this
 * project can have: the development or admin deployment being built with
 * production settings and going into Google.
 *
 * That is not a hypothetical. `deploymentEnv.js` already documents why it is
 * likely: the development Vercel project labels its own scope "Production",
 * which invites someone to set VITE_APP_ENV=production on precisely the
 * deployment that must never have it. If that happened, every guard downstream
 * would do exactly what it was told and emit `index, follow` HTML with
 * canonicals pointing at dev.meetifyy.app.
 *
 * So the site URL itself is checked. A build may only produce indexable output
 * if it is publishing one of these hosts; anything else fails the build rather
 * than shipping. A wrong environment variable becomes a red deploy instead of a
 * silent leak that takes weeks to notice and months to get removed from an
 * index.
 *
 * Note that `admin.meetifyy.app`, `dev-admin.meetifyy.app` and
 * `dev.meetifyy.app` are absent, and must stay absent.
 */
/**
 * The one hostname that is canonical. Every canonical tag, every og:url and
 * every sitemap entry names this host and no other.
 */
export const CANONICAL_HOST = 'meetifyy.app';

/**
 * Hostnames the production site legitimately answers on.
 *
 * `www` is here because it may be attached to the project, not because it is
 * canonical: serving the same pages on two hosts splits the ranking signal
 * between them, so every non-canonical entry is 308-redirected to
 * CANONICAL_HOST at the edge (see PRODUCTION_HOST_REDIRECTS). Listing it makes
 * a build for it valid; redirecting it makes sure nobody is ever served by it.
 *
 * If www is not attached to the Vercel project, the redirect simply never
 * matches. That is the correct behaviour for a rule conditioned on an incoming
 * Host header, not a latent bug: there is no request to redirect.
 */
export const PRODUCTION_HOSTS = [CANONICAL_HOST, `www.${CANONICAL_HOST}`];

/**
 * Host redirects the edge must perform, derived rather than written by hand.
 *
 * Generated from the two constants above so the redirect target and the
 * canonical tag cannot disagree. They disagreeing is the failure worth
 * preventing: a canonical pointing at one host while the edge redirects to the
 * other is a loop from the crawler's point of view, and it stalls indexing
 * completely.
 */
export const PRODUCTION_HOST_REDIRECTS = PRODUCTION_HOSTS
  .filter((host) => host !== CANONICAL_HOST)
  .map((host) => ({ from: host, to: `https://${CANONICAL_HOST}` }));

/**
 * Whether a site URL names the public production site.
 *
 * Exact hostname equality, never `endsWith`. `endsWith('meetifyy.app')` would
 * accept `dev.meetifyy.app`, `admin.meetifyy.app` and
 * `evil-meetifyy.app` alike, which would make this check worse than useless by
 * appearing to pass.
 */
export function isProductionSiteUrl(rawSiteUrl) {
  const value = String(rawSiteUrl || '').trim();
  if (!value) return false;
  let host;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return false;
  }
  return PRODUCTION_HOSTS.includes(host);
}

/** Brand constants that appear in metadata rather than in the UI. */
export const SITE = {
  name: 'Meetifyy',
  /** Used for `og:image:alt` and the Organization logo. */
  logoPath: '/logo-512.png',
  ogImagePath: '/og/meetifyy-og.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  locale: 'en_US',
  lang: 'en',
  /**
   * Profiles the brand actually controls. These become `sameAs` on the
   * Organization schema, which is how a knowledge panel links the site to its
   * social accounts. Only add an account that genuinely belongs to Meetifyy.
   */
  sameAs: [
    'https://www.instagram.com/meetifyy.in',
    'https://www.linkedin.com/company/meetifyy/',
  ],
};

/**
 * Robots directives, named so the intent is readable at the call site.
 *
 * `INDEXABLE` carries the max-preview family because without them Google caps
 * the snippet and thumbnail conservatively, which is what makes a result look
 * cheap next to competitors that set them.
 *
 * `PRIVATE` is `noindex, follow`, not `noindex, nofollow`. Once a page is
 * excluded, `follow` still lets a crawler traverse it to the public pages it
 * links to; `nofollow` would strand them. `nofollow` is reserved for whole
 * deployments that must be treated as if they do not exist.
 */
export const ROBOTS = {
  INDEXABLE: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
  PRIVATE: 'noindex, follow',
  HIDDEN: 'noindex, nofollow, noarchive, nosnippet, noimageindex',
};

/**
 * Every route the public internet can reach without an account.
 *
 * This is an ALLOW-LIST, and that direction matters. The app has roughly thirty
 * routes and all but these sit behind `ProtectedRoute`; enumerating the public
 * ones means a newly added page is private until someone deliberately lists it
 * here, rather than public until someone remembers to exclude it.
 *
 * `indexable: false` entries are still listed because they are publicly
 * reachable and therefore still need a title and an explicit robots directive.
 * They are simply never offered to a search engine.
 */
export const PUBLIC_ROUTES = [
  {
    path: '/',
    indexable: true,
    changefreq: 'weekly',
    priority: 1.0,
    title: 'Meetifyy | Discover People, Communities and Events',
    description:
      'Meetifyy brings students together around what they actually care about. Join communities, find events on campus, and meet people worth knowing.',
    ogType: 'website',
  },
  {
    path: '/about',
    indexable: true,
    changefreq: 'monthly',
    priority: 0.8,
    title: 'About Meetifyy',
    description:
      'Why we built Meetifyy, who it is for, and how we are trying to make campus life easier to be part of rather than harder to keep up with.',
    ogType: 'website',
  },
  {
    path: '/help-and-support',
    indexable: true,
    changefreq: 'weekly',
    priority: 0.7,
    title: 'Help and Support | Meetifyy',
    description:
      'Answers to the questions we get asked most about accounts, communities, events and privacy. Message the team directly if you still need a hand.',
    ogType: 'website',
  },
  {
    path: '/community-guidelines',
    indexable: true,
    changefreq: 'yearly',
    priority: 0.5,
    title: 'Community Guidelines | Meetifyy',
    description:
      'What we expect from everyone on Meetifyy, how reports are reviewed, and the standards that keep communities here worth being part of.',
    ogType: 'article',
  },
  {
    path: '/privacy-policy',
    indexable: true,
    changefreq: 'yearly',
    priority: 0.5,
    title: 'Privacy Policy | Meetifyy',
    description:
      'What personal information Meetifyy collects, how it is used and stored, who it is shared with, and the control you keep over your own data.',
    ogType: 'article',
  },
  {
    path: '/terms-and-conditions',
    indexable: true,
    changefreq: 'yearly',
    priority: 0.5,
    title: 'Terms of Service | Meetifyy',
    description:
      'The agreement between you and Meetifyy, covering your account, the content you post, acceptable use, and how either side can end it.',
    ogType: 'article',
  },
  {
    path: '/cookie-policy',
    indexable: true,
    changefreq: 'yearly',
    priority: 0.4,
    title: 'Cookie Policy | Meetifyy',
    description:
      'The cookies Meetifyy sets, what each one is for, how long it lasts, and how to change your preferences at any point.',
    ogType: 'article',
  },

  // ── Publicly reachable, deliberately not indexed ─────────────────────────
  //
  // A sign-in form has nothing to rank for and every reason not to: it competes
  // with the homepage for brand queries, and a result that drops a searcher on
  // an empty password field is a worse answer than the page that explains what
  // the product is. Password recovery is worse still, because those URLs are
  // reached from an email and carry a token.
  {
    path: '/login',
    indexable: false,
    title: 'Sign in to Meetifyy',
    description: 'Sign in to your Meetifyy account.',
    robots: ROBOTS.PRIVATE,
  },
  {
    path: '/signup',
    indexable: false,
    title: 'Create your Meetifyy account',
    description: 'Create a Meetifyy account and find your people.',
    robots: ROBOTS.PRIVATE,
  },
  {
    path: '/forgot-password',
    indexable: false,
    title: 'Reset your password | Meetifyy',
    description: 'Request a password reset link for your Meetifyy account.',
    robots: ROBOTS.PRIVATE,
  },
  {
    path: '/reset-password',
    // HIDDEN rather than PRIVATE: this URL arrives with a recovery token in it.
    // `noarchive` and `nosnippet` stop any crawler that reaches one from
    // retaining or displaying it.
    indexable: false,
    title: 'Choose a new password | Meetifyy',
    description: 'Set a new password for your Meetifyy account.',
    robots: ROBOTS.HIDDEN,
  },
];

/**
 * Every path the React application actually serves, as edge routing patterns.
 *
 * WHY THIS HAS TO EXIST
 * The site used to answer EVERY url with the SPA shell and a 200. A dead link,
 * a typo and a retired campaign url were all indistinguishable from a real
 * page: the server said "found", the app then redirected to the landing page,
 * and a crawler recorded another duplicate of the homepage. That is a soft 404,
 * and there is no way to fix it from inside a document that has already been
 * served with a 200.
 *
 * Enumerating the real routes is what makes a true 404 possible. Anything that
 * matches one of these is rewritten to the SPA shell; anything else matches no
 * route at all, so the platform serves 404.html with an actual 404 status,
 * before a single byte of JavaScript runs. No serverless function, no cost per
 * request.
 *
 * THE RISK THIS CARRIES, AND WHAT CONTAINS IT
 * A route added to App.jsx and forgotten here would 404 in production while
 * working perfectly in development. That failure is worse than the soft 404
 * this replaces, so it is not left to discipline: `seoRoutes.test.js` parses
 * App.jsx, expands every route it finds into concrete paths, and fails if any
 * of them is not matched here. The list cannot silently fall behind the router.
 *
 * Patterns use the platform's path-to-regexp syntax: `:name` is one segment,
 * `:name*` is zero or more, and a literal has no parameters.
 */
export const APP_ROUTE_PATTERNS = [
  // Authenticated application shell.
  '/home',
  '/search',
  '/notifications',
  '/saved',
  '/onboarding',
  '/settings',
  '/settings/:panel',
  '/communities',
  '/communities/:id',
  '/post/:id',
  '/profile',
  '/profile/:username',
  '/campus',
  '/campus/directory',
  '/campus/communities',
  '/campus/events',
  '/campus/events/:id',
  '/crew',
  '/crew/create',
  '/crew/:id',
  // Messages takes up to two optional segments, and /inbox is its retired
  // prefix, kept routable because old links and notifications still use it.
  '/messages',
  '/messages/:path*',
  '/inbox',
  '/inbox/:path*',

  /**
   * Configured but currently unrouted, and listed anyway.
   *
   * `AUTH_CALLBACK_PATH` and `AUTH_VERIFY_EMAIL_PATH` are defined in both
   * frontend and backend config and consumed by neither, which means the only
   * thing that decides whether they are ever requested is the Redirect URLs
   * list in the Supabase dashboard, which is not in this repository and cannot
   * be checked from it.
   *
   * If one is configured there and this list omitted it, a confirmation link
   * from a real signup email would hard 404 and the account would be stranded.
   * Routing them to the shell costs nothing and fails safe: today they render
   * the app's Not Found, exactly as they did before, instead of breaking auth.
   */
  '/auth/:path*',
  '/verify-email',

  /**
   * Development-only screens. They exist as routes solely in a dev build, and
   * the development deployment shares this configuration file with production,
   * so omitting them would break the dev tooling. On production they reach the
   * shell and render Not Found; they are disallowed in robots.txt and the
   * document is noindex either way.
   */
  '/dev/:path*',
  '/logo-animation',
];

/**
 * Compiles one edge routing pattern to a regular expression.
 *
 * Deliberately tiny and deliberately not `path-to-regexp` itself: this needs to
 * run in a plain `node` build script and in a browser bundle, and adding a
 * dependency to both in order to match twenty-odd literal paths would be a poor
 * trade. It supports exactly the three forms the patterns above use.
 */
function patternToRegExp(pattern) {
  const source = pattern
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.endsWith('*')) return '(?:/[^/]+)*'; // :name* , zero or more
      if (segment.endsWith('?')) return '(?:/[^/]+)?'; // :name? , optional one
      if (segment.startsWith(':')) return '/[^/]+'; //     :name  , exactly one
      return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
    })
    .join('');
  return new RegExp(`^${source || '/'}/?$`);
}

const APP_ROUTE_REGEXPS = APP_ROUTE_PATTERNS.map(patternToRegExp);

/**
 * Whether a pathname is a real route rather than a dead link.
 *
 * Used in two places that must agree: the edge, to decide between the SPA shell
 * and a 404, and `ProtectedRoute`, to decide between "sign in to see this" and
 * "this does not exist". Before they shared this function, the second question
 * was never asked, and every unknown url was treated as a page the visitor
 * simply needed to authenticate for.
 */
export function isKnownAppRoute(pathname) {
  const path = normalisePathname(pathname);
  if (findRouteSeo(path)) return true;
  if (PERMANENT_REDIRECTS.some((r) => r.from === path)) return true;
  return APP_ROUTE_REGEXPS.some((re) => re.test(path));
}

/**
 * Permanent redirects, resolved at the edge rather than in React.
 *
 * The app already renders `<Navigate replace>` for each of these, which fixes
 * the user experience but not the SEO one: a client-side redirect is a 200 on
 * the original URL, so a crawler sees two URLs serving the same document and
 * has to guess which is canonical. Served as a 308 these collapse into one.
 */
export const PERMANENT_REDIRECTS = [
  { from: '/terms', to: '/terms-and-conditions' },
  { from: '/help', to: '/help-and-support' },
  { from: '/support', to: '/help-and-support' },
  { from: '/contact', to: '/help-and-support' },
];

/** Route entries that belong in the sitemap. */
export const INDEXABLE_ROUTES = PUBLIC_ROUTES.filter((route) => route.indexable);

/** Strips a trailing slash so `${siteUrl}${path}` never doubles it. */
export function normaliseSiteUrl(rawSiteUrl) {
  return String(rawSiteUrl || '').trim().replace(/\/+$/, '');
}

/**
 * Absolute URL for a path.
 *
 * Canonicals, `og:url` and sitemap entries must all be absolute, and all three
 * must agree character for character. Building them through one function is
 * what guarantees that.
 */
export function absoluteUrl(siteUrl, path) {
  const base = normaliseSiteUrl(siteUrl);
  const suffix = path === '/' ? '' : path;
  return `${base}${suffix || '/'}`;
}

/**
 * The metadata for a pathname, or `null` if the route is not public.
 *
 * Returning `null` rather than a default is intentional: the caller then has to
 * decide what an unlisted route means, and every caller decides "not indexable".
 */
export function findRouteSeo(pathname) {
  const path = normalisePathname(pathname);
  return PUBLIC_ROUTES.find((route) => route.path === path) || null;
}

/**
 * Collapses the variations of one path into the single form used as a key.
 *
 * `/about`, `/about/`, `/About` and `/about?ref=x` are one page. Left alone
 * they are four URLs a crawler will happily index separately, which is the
 * duplicate-content problem that canonical tags exist to solve. Query strings
 * are dropped entirely: no public route here takes a parameter that changes
 * what the page says, so every parameterised variant canonicalises to the bare
 * path.
 */
export function normalisePathname(pathname) {
  const raw = String(pathname || '/').split('?')[0].split('#')[0];
  const lower = raw.toLowerCase();
  const trimmed = lower.length > 1 ? lower.replace(/\/+$/, '') : lower;
  return trimmed || '/';
}

/**
 * Full head metadata for a route, ready to render or inject.
 *
 * `isProduction` gates every outward-facing field. On a development, staging or
 * preview build the result carries no canonical, no Open Graph and no Twitter
 * card, and the robots directive is HIDDEN. That is the point: an internal
 * deployment should not merely rank badly, it should have nothing for a crawler
 * or a link unfurler to display at all.
 */
export function buildPageSeo({ pathname, siteUrl, isProduction }) {
  const route = findRouteSeo(pathname);
  const path = normalisePathname(pathname);

  // Unlisted route: reachable only behind auth, or not a route at all. Either
  // way it gets a usable tab title and no invitation to index.
  const title = route?.title || SITE.name;
  const description = route?.description || '';

  if (!isProduction) {
    return {
      path,
      title,
      description,
      robots: ROBOTS.HIDDEN,
      canonical: null,
      openGraph: null,
      twitter: null,
      jsonLd: [],
    };
  }

  const robots = route ? route.robots || ROBOTS.INDEXABLE : ROBOTS.PRIVATE;
  const isIndexable = Boolean(route?.indexable);

  // A canonical on a noindex page is contradictory: it nominates the URL as the
  // preferred version of content that is simultaneously withheld. Only
  // indexable routes get one.
  const canonical = isIndexable ? absoluteUrl(siteUrl, path) : null;

  // Likewise, no social card for a page we do not want circulating. A sign-in
  // form that unfurls with a polished preview is an invitation to share it.
  const openGraph = isIndexable
    ? {
        type: route.ogType || 'website',
        siteName: SITE.name,
        title: route.title,
        description: route.description,
        url: absoluteUrl(siteUrl, path),
        image: absoluteUrl(siteUrl, SITE.ogImagePath),
        imageWidth: SITE.ogImageWidth,
        imageHeight: SITE.ogImageHeight,
        imageAlt: `${SITE.name}, where students find communities and events`,
        locale: SITE.locale,
      }
    : null;

  const twitter = isIndexable
    ? {
        card: 'summary_large_image',
        title: route.title,
        description: route.description,
        image: absoluteUrl(siteUrl, SITE.ogImagePath),
        imageAlt: `${SITE.name}, where students find communities and events`,
      }
    : null;

  return {
    path,
    title,
    description,
    robots,
    canonical,
    openGraph,
    twitter,
    jsonLd: isIndexable ? buildJsonLd({ path, siteUrl }) : [],
  };
}

/**
 * Structured data, restricted to the two schemas this site can honestly claim.
 *
 * Organization and WebSite describe the publisher and the site itself, both of
 * which are verifiable from the homepage, and Organization is what a knowledge
 * panel is assembled from.
 *
 * Deliberately absent:
 *   - FAQPage on /help-and-support. The articles are fetched from the API after
 *     mount, so a build-time copy would be asserting content that may no longer
 *     be on the page, and Google restricted FAQ rich results to government and
 *     health sites in 2023 regardless. It would be an unverifiable claim in
 *     exchange for nothing.
 *   - Event, Person and Organization-for-communities. Those pages require an
 *     account, so the markup would describe content the crawler cannot see,
 *     which is exactly what the structured data guidelines prohibit.
 *   - BreadcrumbList. The public pages are one level deep and have no
 *     breadcrumb trail on screen to mirror.
 */
export function buildJsonLd({ path, siteUrl }) {
  if (path !== '/') return [];

  const base = normaliseSiteUrl(siteUrl);

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${base}/#organization`,
      name: SITE.name,
      url: `${base}/`,
      logo: {
        '@type': 'ImageObject',
        url: `${base}${SITE.logoPath}`,
        width: 512,
        height: 512,
      },
      sameAs: SITE.sameAs,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${base}/#website`,
      name: SITE.name,
      url: `${base}/`,
      publisher: { '@id': `${base}/#organization` },
      inLanguage: SITE.lang,
    },
  ];
}
