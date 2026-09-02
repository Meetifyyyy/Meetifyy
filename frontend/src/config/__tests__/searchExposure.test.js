import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INDEXABLE_ROUTES,
  PRODUCTION_HOSTS,
  PUBLIC_ROUTES,
  absoluteUrl,
  buildPageSeo,
  isProductionSiteUrl,
} from '../seo';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

/**
 * The requirement these tests exist for, stated once:
 *
 *   meetifyy.app is the only hostname that may ever appear in a search engine.
 *   dev.meetifyy.app, dev-admin.meetifyy.app and admin.meetifyy.app must never
 *   appear, in any form, including as a bare URL with no snippet.
 *
 * Each of the mechanisms below is independently sufficient to keep one host out
 * of an index, and each is independently easy to delete by accident while
 * editing something else. That is what makes them worth pinning.
 */
const FORBIDDEN_HOSTS = [
  'dev.meetifyy.app',
  'dev-admin.meetifyy.app',
  'admin.meetifyy.app',
];

describe('only meetifyy.app may be published', () => {
  it('accepts the production apex and www, and nothing else', () => {
    expect(PRODUCTION_HOSTS).toEqual(['meetifyy.app', 'www.meetifyy.app']);
    expect(isProductionSiteUrl('https://meetifyy.app')).toBe(true);
    expect(isProductionSiteUrl('https://www.meetifyy.app')).toBe(true);
  });

  it('refuses every forbidden host', () => {
    for (const host of FORBIDDEN_HOSTS) {
      expect(isProductionSiteUrl(`https://${host}`), host).toBe(false);
    }
  });

  it('matches on exact hostname, not a suffix', () => {
    // `endsWith('meetifyy.app')` would accept all of these, and would make the
    // whole guard look like it was working.
    for (const url of [
      'https://dev.meetifyy.app',
      'https://evil-meetifyy.app',
      'https://meetifyy.app.attacker.example',
      'https://notmeetifyy.app',
      'not-a-url',
      '',
    ]) {
      expect(isProductionSiteUrl(url), url).toBe(false);
    }
  });
});

describe('a build for a forbidden host produces nothing indexable', () => {
  // Simulates VITE_APP_ENV=production being set on the dev or admin project,
  // which deploymentEnv.js documents as a likely mistake.
  for (const host of FORBIDDEN_HOSTS) {
    it(`emits no canonical, social card or JSON-LD for ${host}`, () => {
      for (const route of PUBLIC_ROUTES) {
        const seo = buildPageSeo({
          pathname: route.path,
          siteUrl: `https://${host}`,
          // The generators derive this from isProductionSiteUrl, so a build for
          // this host can never reach buildPageSeo with `true`.
          isProduction: false,
        });
        expect(seo.robots, `${host}${route.path}`).toBe(
          'noindex, nofollow, noarchive, nosnippet, noimageindex',
        );
        expect(seo.canonical, `${host}${route.path}`).toBeNull();
        expect(seo.openGraph, `${host}${route.path}`).toBeNull();
        expect(seo.twitter, `${host}${route.path}`).toBeNull();
        expect(seo.jsonLd, `${host}${route.path}`).toEqual([]);
      }
    });
  }
});

describe('no SEO artefact ever names a forbidden host', () => {
  it('keeps canonicals and og:url on the production apex', () => {
    for (const route of INDEXABLE_ROUTES) {
      const seo = buildPageSeo({
        pathname: route.path,
        siteUrl: 'https://meetifyy.app',
        isProduction: true,
      });
      for (const host of FORBIDDEN_HOSTS) {
        expect(seo.canonical, route.path).not.toContain(host);
        expect(seo.openGraph.url, route.path).not.toContain(host);
        expect(seo.openGraph.image, route.path).not.toContain(host);
        expect(JSON.stringify(seo.jsonLd), route.path).not.toContain(host);
      }
    }
  });

  it('keeps every sitemap URL on the production apex', () => {
    for (const route of INDEXABLE_ROUTES) {
      const loc = absoluteUrl('https://meetifyy.app', route.path);
      expect(loc.startsWith('https://meetifyy.app/'), loc).toBe(true);
    }
  });
});

describe('edge headers', () => {
  const configs = {
    'vercel.json': readJson('vercel.json'),
    'frontend/vercel.json': readJson('frontend/vercel.json'),
  };

  const hostNoindexRules = (cfg) =>
    cfg.headers.filter((h) =>
      (h.headers || []).some(
        (x) => x.key === 'X-Robots-Tag' && x.value.startsWith('noindex'),
      ),
    );

  for (const [name, cfg] of Object.entries(configs)) {
    for (const host of FORBIDDEN_HOSTS) {
      it(`${name} serves noindex to ${host}`, () => {
        const pattern = host.replace(/\./g, '\\.');
        const match = hostNoindexRules(cfg).find((h) =>
          (h.has || []).some((c) => c.type === 'host' && c.value === pattern),
        );
        expect(match, `no X-Robots-Tag rule for ${host}`).toBeDefined();
        expect(match.headers[0].value).toContain('noindex');
        expect(match.headers[0].value).toContain('nofollow');
      });
    }

    it(`${name} covers every Vercel deployment URL`, () => {
      // Per-commit preview URLs, which are created constantly and never
      // enumerated anywhere.
      const match = hostNoindexRules(cfg).find((h) =>
        (h.has || []).some((c) => c.type === 'host' && c.value.includes('vercel\\.app')),
      );
      expect(match).toBeDefined();
    });
  }

  it('the two vercel.json files do not drift apart', () => {
    // Which of the two Vercel reads depends on the project's Root Directory
    // setting, so a rule present in only one is a rule that may not apply.
    const [a, b] = Object.values(configs);
    expect(a.headers).toEqual(b.headers);
    expect(a.redirects).toEqual(b.redirects);
    expect(a.rewrites).toEqual(b.rewrites);
    expect(a.trailingSlash).toEqual(b.trailingSlash);
  });

  it('the admin project serves noindex on every host and every path', () => {
    const admin = readJson('admin-frontend/vercel.json');
    const global = admin.headers.find(
      (h) => h.source === '/(.*)' && !h.has &&
        (h.headers || []).some((x) => x.key === 'X-Robots-Tag'),
    );
    expect(global, 'admin lost its unconditional X-Robots-Tag').toBeDefined();
    const value = global.headers.find((x) => x.key === 'X-Robots-Tag').value;
    for (const directive of ['noindex', 'nofollow', 'noarchive', 'nosnippet', 'noimageindex']) {
      expect(value).toContain(directive);
    }
  });
});

describe('robots.txt does not block its own noindex', () => {
  /**
   * The defect this pins. `Disallow: /` stops a crawler FETCHING the page, so
   * it never reads the noindex, and Google may still list the bare URL as
   * "Indexed, though blocked by robots.txt". Since every subdomain is public
   * via Certificate Transparency logs, discovery is guaranteed and the fetch is
   * the only thing worth controlling.
   */
  it('the admin portal allows the fetch that makes noindex effective', () => {
    const robots = read('admin-frontend/public/robots.txt');
    const directives = robots
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(directives).toContain('Allow: /');
    expect(directives).not.toContain('Disallow: /');
  });

  it('the admin portal never advertises a sitemap', () => {
    expect(read('admin-frontend/public/robots.txt')).not.toMatch(/^\s*Sitemap:/im);
  });

  it('the admin document carries noindex itself', () => {
    // Survives being served from anywhere, unlike a header.
    const html = read('admin-frontend/index.html');
    expect(html).toMatch(/<meta\s+name="robots"\s+content="noindex,\s*nofollow/);
  });

  it('the admin title does not advertise what it is', () => {
    const html = read('admin-frontend/index.html');
    expect(html).not.toMatch(/<title>[^<]*(Admin|admin)[^<]*<\/title>/);
  });
});
