import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_ROUTE_PATTERNS,
  CANONICAL_HOST,
  PERMANENT_REDIRECTS,
  PRODUCTION_HOSTS,
  PRODUCTION_HOST_REDIRECTS,
  PUBLIC_ROUTES,
  isKnownAppRoute,
} from '../seo';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

/**
 * Turns a React Router path into concrete urls a visitor could actually request.
 *
 * `/messages/:a?/:b?` becomes /messages, /messages/x and /messages/x/y;
 * `/inbox/*` becomes /inbox and /inbox/x. Comparing expanded urls rather than
 * pattern strings is the point: the router and the edge use different pattern
 * syntaxes, so the only meaningful comparison is what each does with a real path.
 */
function expandRouterPath(pattern) {
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return [base, `${base}/x`, `${base}/x/y`];
  }
  const segments = pattern.split('/').filter(Boolean);
  let variants = [''];
  for (const segment of segments) {
    if (segment.startsWith(':')) {
      const optional = segment.endsWith('?');
      const next = [];
      for (const prefix of variants) {
        if (optional) next.push(prefix);
        next.push(`${prefix}/x`);
      }
      variants = next;
    } else {
      variants = variants.map((prefix) => `${prefix}/${segment}`);
    }
  }
  return variants.map((v) => v || '/');
}

/**
 * Every `path:` in App.jsx, read out of the source rather than duplicated here,
 * because a list kept in step by hand is the thing these tests exist to catch.
 */
function routerPathsFromApp() {
  const source = read('frontend/src/App.jsx');
  return [...source.matchAll(/path:\s*'([^']+)'/g)]
    .map((m) => m[1])
    .filter((p) => p !== '*');
}

describe('the edge knows every route the router serves', () => {
  /**
   * The failure this prevents.
   *
   * vercel.json no longer has a catch-all, which is what makes a true 404
   * status possible: an unmatched url reaches no route, so the platform answers
   * 404 instead of serving the SPA shell with a 200. The cost of that design is
   * that a route added to App.jsx and forgotten in APP_ROUTE_PATTERNS would
   * work perfectly in development and hard-404 in production, which is a worse
   * failure than the soft 404 it replaced. So it is not left to memory.
   */
  it('finds routes to check', () => {
    // Guards against the regex silently matching nothing after a refactor,
    // which would make every assertion below vacuous.
    expect(routerPathsFromApp().length).toBeGreaterThan(25);
  });

  for (const routerPath of routerPathsFromApp()) {
    it(`routes ${routerPath}`, () => {
      for (const url of expandRouterPath(routerPath)) {
        expect(isKnownAppRoute(url), `${routerPath} -> ${url} is not routed`).toBe(true);
      }
    });
  }
});

describe('unknown urls are genuinely unknown', () => {
  it('rejects dead links, scans and near-misses', () => {
    const shouldBe404 = [
      '/old-campaign', '/nope', '/wp-admin', '/index.php', '/home/extra',
      '/communities/a/b', '/campus/events/1/x', '/profile/sam/extra',
      '/abouts', '/help-and-support/x',
    ];
    for (const url of shouldBe404) {
      expect(isKnownAppRoute(url), `${url} should 404`).toBe(false);
    }
  });
});

describe('vercel routing', () => {
  const configs = {
    'vercel.json': readJson('vercel.json'),
    'frontend/vercel.json': readJson('frontend/vercel.json'),
  };

  for (const [name, cfg] of Object.entries(configs)) {
    it(`${name} has no catch-all, so unmatched urls can 404`, () => {
      const catchAll = cfg.rewrites.filter(
        (r) => r.destination === '/index.html' || r.source.includes('(?!'),
      );
      expect(catchAll, 'a catch-all rewrite makes every url answer 200').toEqual([]);
    });

    it(`${name} rewrites every application route to the noindex shell`, () => {
      const shell = cfg.rewrites
        .filter((r) => r.destination === '/app.html')
        .map((r) => r.source);
      expect(shell.sort()).toEqual([...APP_ROUTE_PATTERNS].sort());
    });

    it(`${name} serves each public page its own prerendered document`, () => {
      for (const route of PUBLIC_ROUTES) {
        if (route.path === '/') continue; // index.html, resolved from the filesystem
        const rule = cfg.rewrites.find((r) => r.source === route.path);
        expect(rule, `no rewrite for ${route.path}`).toBeDefined();
        expect(rule.destination).toBe(`${route.path}.html`);
      }
    });

    it(`${name} 308s every alias path`, () => {
      for (const { from, to } of PERMANENT_REDIRECTS) {
        const rule = cfg.redirects.find((r) => r.source === from);
        expect(rule, `no redirect for ${from}`).toBeDefined();
        expect(rule.destination).toBe(to);
        expect(rule.permanent).toBe(true);
      }
    });
  }
});

describe('one canonical host', () => {
  it('canonicalises to the apex', () => {
    expect(CANONICAL_HOST).toBe('meetifyy.app');
    expect(PRODUCTION_HOSTS[0]).toBe(CANONICAL_HOST);
  });

  it('redirects every non-canonical production host to it', () => {
    // Derived, so the redirect target and the canonical tag cannot drift apart.
    // If they did, a crawler would see a canonical naming a host that redirects
    // away from itself, and indexing stalls on the contradiction.
    const nonCanonical = PRODUCTION_HOSTS.filter((h) => h !== CANONICAL_HOST);
    expect(PRODUCTION_HOST_REDIRECTS.map((r) => r.from)).toEqual(nonCanonical);
    for (const redirect of PRODUCTION_HOST_REDIRECTS) {
      expect(redirect.to).toBe(`https://${CANONICAL_HOST}`);
    }
  });

  it('is wired into both vercel configs as a 308', () => {
    for (const name of ['vercel.json', 'frontend/vercel.json']) {
      const cfg = readJson(name);
      for (const { from, to } of PRODUCTION_HOST_REDIRECTS) {
        const rule = cfg.redirects.find((r) =>
          (r.has || []).some((c) => c.key === 'host' && c.value === from),
        );
        expect(rule, `${name} does not redirect ${from}`).toBeDefined();
        expect(rule.destination).toBe(`${to}/:path*`);
        expect(rule.permanent).toBe(true);
      }
    }
  });
});

describe('viewport and policy hygiene in index.html', () => {
  const html = read('frontend/index.html');
  const css = read('frontend/src/styles/global.css');

  it('does not disable pinch-zoom', () => {
    // WCAG 2.1 AA, 1.4.4 Resize Text. The iOS focus-zoom this used to suppress
    // is handled by the 16px floor for touch devices in global.css instead.
    const viewport = html.match(/<meta name="viewport"[^>]*>/)[0];
    expect(viewport).not.toContain('user-scalable=no');
    expect(viewport).not.toContain('maximum-scale');
  });

  it('keeps the touch font-size floor that replaced it', () => {
    expect(css).toMatch(/@media \(pointer: coarse\) and \(max-width: 768px\)/);
    expect(css).toMatch(/font-size:\s*16px/);
  });

  it('confines the dev CSP and the dev host hop to strippable blocks', () => {
    for (const marker of ['DEV-CSP:START', 'DEV-CSP:END', 'DEV-HOST-GUARD:START', 'DEV-HOST-GUARD:END']) {
      expect(html, `missing ${marker}`).toContain(marker);
    }
    const cspBlock = html.slice(html.indexOf('DEV-CSP:START'), html.indexOf('DEV-CSP:END'));
    expect(cspBlock).toContain('Content-Security-Policy');
    expect(cspBlock).toContain('localhost:4000');
  });

  it('scopes smooth scrolling to the landing page', () => {
    expect(css).toMatch(/html\.landing-scroll-active\s*\{[^}]*scroll-behavior:\s*smooth/);
    // Never unscoped: the app shell restores scroll position and runs its own
    // bounded scrollers, and animating those fights what they implement.
    expect(css).not.toMatch(/^html\s*\{[^}]*scroll-behavior:\s*smooth/m);
  });
});
