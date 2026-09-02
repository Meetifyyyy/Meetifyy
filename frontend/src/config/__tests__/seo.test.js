import { describe, expect, it } from 'vitest';
import {
  INDEXABLE_ROUTES,
  PUBLIC_ROUTES,
  ROBOTS,
  buildPageSeo,
  findRouteSeo,
  normalisePathname,
} from '../seo';

const SITE = 'https://meetifyy.app';
const prod = (pathname) => buildPageSeo({ pathname, siteUrl: SITE, isProduction: true });

/**
 * Every string that can reach a search result or a link preview.
 *
 * Collected in one place because the copy rules below are the kind that hold
 * for a week and then quietly stop holding: someone adds a route, pastes a
 * description from a doc, and an em dash or a duplicate ships to production
 * where nobody looks at it again.
 */
const SEARCH_FACING = PUBLIC_ROUTES.flatMap((route) => [route.title, route.description]);

describe('search-facing copy', () => {
  it('contains no em dash, en dash or other typographic dashes', () => {
    // The requirement that started this: these render verbatim in a result and
    // read as machine-written. Covers em, en, horizontal bar and minus.
    const offenders = SEARCH_FACING.filter((text) => /[‒-―−]/.test(text));
    expect(offenders).toEqual([]);
  });

  it('uses at most one pipe, and only to separate the page from the brand', () => {
    const offenders = PUBLIC_ROUTES
      .map((route) => route.title)
      .filter((title) => (title.match(/\|/g) || []).length > 1);
    expect(offenders).toEqual([]);
  });

  it('has no ALL CAPS words, which read as shouting in a result', () => {
    const offenders = SEARCH_FACING.filter((text) => /\b[A-Z]{4,}\b/.test(text));
    expect(offenders).toEqual([]);
  });

  it('keeps titles short enough not to be truncated', () => {
    // Google truncates around 580px, which is roughly 60 characters.
    for (const route of PUBLIC_ROUTES) {
      expect(route.title.length, route.path).toBeLessThanOrEqual(60);
    }
  });

  it('keeps indexable descriptions in the range Google will show whole', () => {
    // Under ~110 and Google pads the snippet from page text instead; over ~160
    // and the tail is cut. Only indexable routes matter: the rest are never
    // rendered as a snippet.
    for (const route of INDEXABLE_ROUTES) {
      expect(route.description.length, route.path).toBeGreaterThanOrEqual(110);
      expect(route.description.length, route.path).toBeLessThanOrEqual(165);
    }
  });

  it('gives every route its own title and its own description', () => {
    // Duplicates are the most common cause of "Duplicate without user-selected
    // canonical" in Search Console.
    const titles = PUBLIC_ROUTES.map((r) => r.title);
    const descriptions = PUBLIC_ROUTES.map((r) => r.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});

describe('normalisePathname', () => {
  it('collapses the variants of one path to a single key', () => {
    for (const variant of ['/about', '/about/', '/About', '/about?utm_source=x', '/about#top']) {
      expect(normalisePathname(variant)).toBe('/about');
    }
  });

  it('leaves the root as the root', () => {
    expect(normalisePathname('/')).toBe('/');
    expect(normalisePathname('')).toBe('/');
  });
});

describe('indexable routes', () => {
  it('advertises an absolute canonical that matches its own og:url', () => {
    for (const route of INDEXABLE_ROUTES) {
      const seo = prod(route.path);
      expect(seo.canonical, route.path).toMatch(/^https:\/\//);
      expect(seo.openGraph.url, route.path).toBe(seo.canonical);
    }
  });

  it('carries a full social card', () => {
    for (const route of INDEXABLE_ROUTES) {
      const seo = prod(route.path);
      expect(seo.openGraph.image).toBe(`${SITE}/og/meetifyy-og.png`);
      expect(seo.twitter.card).toBe('summary_large_image');
    }
  });

  it('is reachable through the same path the sitemap will publish', () => {
    for (const route of INDEXABLE_ROUTES) {
      expect(findRouteSeo(route.path)).not.toBeNull();
    }
  });
});

describe('routes that must never be indexed', () => {
  const privateRoutes = PUBLIC_ROUTES.filter((r) => !r.indexable).map((r) => r.path);

  it('covers every authentication surface', () => {
    expect(privateRoutes).toEqual(
      expect.arrayContaining(['/login', '/signup', '/forgot-password', '/reset-password']),
    );
  });

  it('offers no canonical and no social card', () => {
    // A canonical would nominate the page as the preferred version of content
    // that is simultaneously withheld, and a polished unfurl of a sign-in form
    // is an invitation to share it.
    for (const path of privateRoutes) {
      const seo = prod(path);
      expect(seo.canonical, path).toBeNull();
      expect(seo.openGraph, path).toBeNull();
      expect(seo.twitter, path).toBeNull();
      expect(seo.jsonLd, path).toEqual([]);
      expect(seo.robots, path).toMatch(/^noindex/);
    }
  });

  it('hides the password reset URL from snippets and archives', () => {
    // That URL arrives from an email carrying a recovery token.
    expect(prod('/reset-password').robots).toBe(ROBOTS.HIDDEN);
  });

  it('never appears in the sitemap', () => {
    for (const path of privateRoutes) {
      expect(INDEXABLE_ROUTES.map((r) => r.path)).not.toContain(path);
    }
  });
});

describe('routes that are not public at all', () => {
  // Authenticated application surfaces, admin paths, dev previews, typos.
  const unlisted = ['/home', '/settings', '/messages/42', '/admin', '/dev/critical-error', '/nope'];

  it('is non-indexable by default rather than by enumeration', () => {
    for (const path of unlisted) {
      const seo = prod(path);
      expect(seo.robots, path).toBe(ROBOTS.PRIVATE);
      expect(seo.canonical, path).toBeNull();
      expect(seo.openGraph, path).toBeNull();
      expect(seo.jsonLd, path).toEqual([]);
    }
  });
});

describe('non-production deployments', () => {
  // The development frontend, staging, and every Vercel preview URL.
  const dev = (pathname) =>
    buildPageSeo({ pathname, siteUrl: 'https://dev.meetifyy.app', isProduction: false });

  it('withholds every outward-facing signal on every route', () => {
    for (const route of PUBLIC_ROUTES) {
      const seo = dev(route.path);
      expect(seo.robots, route.path).toBe(ROBOTS.HIDDEN);
      expect(seo.canonical, route.path).toBeNull();
      expect(seo.openGraph, route.path).toBeNull();
      expect(seo.twitter, route.path).toBeNull();
      expect(seo.jsonLd, route.path).toEqual([]);
    }
  });

  it('withholds them for the homepage too, which is the one most likely to leak', () => {
    expect(dev('/').robots).toBe(ROBOTS.HIDDEN);
    expect(dev('/').jsonLd).toEqual([]);
  });
});

describe('structured data', () => {
  it('is limited to the homepage', () => {
    expect(prod('/').jsonLd).toHaveLength(2);
    for (const route of INDEXABLE_ROUTES.filter((r) => r.path !== '/')) {
      expect(prod(route.path).jsonLd, route.path).toEqual([]);
    }
  });

  it('describes only the publisher and the site, both verifiable from the page', () => {
    const types = prod('/').jsonLd.map((block) => block['@type']);
    expect(types).toEqual(['Organization', 'WebSite']);
  });

  it('links the WebSite to the Organization by id rather than repeating it', () => {
    const [org, site] = prod('/').jsonLd;
    expect(site.publisher['@id']).toBe(org['@id']);
  });

  it('exposes only absolute URLs and no personal data', () => {
    const serialised = JSON.stringify(prod('/').jsonLd);
    expect(serialised).not.toMatch(/\/(home|settings|profile|messages|admin)\b/);
    for (const block of prod('/').jsonLd) {
      if (block.url) expect(block.url).toMatch(/^https:\/\//);
    }
  });
});
