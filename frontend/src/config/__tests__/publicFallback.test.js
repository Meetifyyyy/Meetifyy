import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_TOP_SEGMENTS,
  PUBLIC_PARENT_PATHS,
  PUBLIC_ROUTES,
  buildPublicFallbackRedirects,
} from '../seo';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const readJson = (p) => JSON.parse(readFileSync(resolve(repoRoot, p), 'utf8'));

/**
 * Resolves a path the way the edge does: redirects in order, first match wins.
 * Returns the destination, or null when nothing matches and the request falls
 * through to the filesystem and rewrites.
 */
function resolveRedirect(path) {
  const rules = buildPublicFallbackRedirects();
  for (const rule of rules) {
    const pattern = rule.source.startsWith('/((?!')
      ? new RegExp(`^${rule.source}$`)
      : new RegExp(`^${rule.source.replace('/:rest+', '(?:/[^/]+)+')}$`);
    if (pattern.test(path)) return rule.destination;
  }
  return null;
}

describe('valid routes are never touched', () => {
  for (const route of PUBLIC_ROUTES) {
    it(`leaves ${route.path} alone`, () => {
      expect(resolveRedirect(route.path)).toBeNull();
    });
  }

  it('leaves the landing page alone', () => {
    // The rule that catches unknown paths uses `.+` rather than `.*` precisely
    // so that "/" cannot match it. With `.*` the empty remainder after the
    // leading slash qualifies and the landing page redirects to itself, which
    // is an infinite loop on the site's most important URL.
    expect(resolveRedirect('/')).toBeNull();
  });
});

describe('an invalid path under a public page goes to that page', () => {
  for (const parent of PUBLIC_PARENT_PATHS) {
    it(`${parent}/nonsense -> ${parent}`, () => {
      expect(resolveRedirect(`${parent}/nonsense`)).toBe(parent);
    });
  }

  it('absorbs any depth beneath the page', () => {
    expect(resolveRedirect('/about/a/b/c')).toBe('/about');
  });
});

describe('an unrecognised path goes to the landing page', () => {
  it.each(['/sded', '/foo/bar', '/wp-admin', '/xyz/1/2/3', '/some-old-campaign'])(
    '%s -> /',
    (path) => {
      expect(resolveRedirect(path)).toBe('/');
    },
  );
});

describe('the application is left to its own routing', () => {
  /**
   * The requirement this pins: the fallback is for the public site only.
   * Authenticated routes have their own 404 behaviour and must not be swept
   * into a redirect to the landing page.
   */
  it.each([
    '/home',
    '/home/extra',
    '/settings',
    '/settings/privacy',
    '/messages',
    '/messages/a/b',
    '/communities/abc',
    '/profile/sam',
    '/campus/events/7',
    '/crew/create',
    '/post/1',
    '/inbox/x',
    '/auth/callback',
  ])('does not redirect %s', (path) => {
    expect(resolveRedirect(path)).toBeNull();
  });
});

describe('static files are never redirected', () => {
  /**
   * Redirects run BEFORE the filesystem is consulted. A rule that did not
   * exclude these would answer every asset request with the landing page and
   * take the site down rather than merely mis-route it.
   */
  it.each([
    '/assets/index-abc123.js',
    '/assets/index-abc123.css',
    '/fonts/inter-100_900-normal-13.woff2',
    '/icons/x.png',
    '/og/meetifyy-og.png',
    '/splash/apple-splash-390x844@3x.png',
    '/robots.txt',
    '/sitemap.xml',
    '/version.json',
    '/sw.js',
    '/manifest.webmanifest',
    '/favicon.png',
    '/api/users/me',
    '/_api/anything',
  ])('serves %s', (path) => {
    expect(resolveRedirect(path)).toBeNull();
  });
});

describe('the known-segment list stays in step with the routes', () => {
  it('is derived, not hand-written', () => {
    // A hand-maintained copy is what would eventually start redirecting a real
    // page to the landing page, which is silent and looks like a routing bug.
    for (const route of PUBLIC_ROUTES) {
      const segment = route.path.split('/').filter(Boolean)[0];
      if (segment) expect(KNOWN_TOP_SEGMENTS).toContain(segment);
    }
  });

  it('contains no route parameters', () => {
    expect(KNOWN_TOP_SEGMENTS.filter((s) => s.startsWith(':'))).toEqual([]);
  });
});

describe('both vercel configs carry the rules, in the right order', () => {
  it.each(['vercel.json', 'frontend/vercel.json'])('%s', (name) => {
    const cfg = readJson(name);
    const sources = cfg.redirects.map((r) => r.source);

    for (const parent of PUBLIC_PARENT_PATHS) {
      expect(sources).toContain(`${parent}/:rest+`);
    }

    const catchAllIndex = sources.findIndex((s) => s.startsWith('/((?!'));
    expect(catchAllIndex).toBeGreaterThan(-1);
    // The catch-all must be LAST. Ahead of the parent rules it would swallow
    // /about/edede and send it to the landing page instead of to /about.
    expect(catchAllIndex).toBe(cfg.redirects.length - 1);
  });

  it('does not drift between the two files', () => {
    expect(readJson('vercel.json').redirects).toEqual(
      readJson('frontend/vercel.json').redirects,
    );
  });

  it('uses temporary redirects for the fallback', () => {
    // A 308 is cached by the browser indefinitely, so a path that is invalid
    // today and a real page next month would keep redirecting for anyone who
    // hit the old version.
    const cfg = readJson('vercel.json');
    const fallback = cfg.redirects.filter(
      (r) => r.source.startsWith('/((?!') || r.source.endsWith('/:rest+'),
    );
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.every((r) => r.permanent === false)).toBe(true);
  });
});
