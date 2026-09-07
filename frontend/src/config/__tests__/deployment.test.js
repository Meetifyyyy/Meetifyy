import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNonProductionHost, isProductionAppEnv } from '../deploymentEnv';

/**
 * The development deployment had VITE_APP_ENV unset. vite.config.js and the
 * robots generator both required the literal "production" and so failed closed;
 * config/index.js compared a value that falls back to Vite's MODE — "production"
 * for any built bundle — and so failed OPEN, registering a service worker on a
 * Cloudflare Access-protected host. These tests pin the rule that replaced it.
 */
describe('isProductionAppEnv', () => {
  it('accepts only the exact production value', () => {
    expect(isProductionAppEnv('production')).toBe(true);
    expect(isProductionAppEnv(' Production ')).toBe(true);
  });

  it('fails closed for anything else', () => {
    // The regression: unset must never mean production.
    expect(isProductionAppEnv(undefined)).toBe(false);
    expect(isProductionAppEnv('')).toBe(false);
    expect(isProductionAppEnv('development')).toBe(false);
    expect(isProductionAppEnv('staging')).toBe(false);
    expect(isProductionAppEnv('prod')).toBe(false);
    expect(isProductionAppEnv('productionn')).toBe(false);
  });
});

describe('isNonProductionHost', () => {
  it('rejects hosts that must never run a caching worker', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      'dev.meetifyy.app',
      'staging.meetifyy.app',
      'meetify-web.vercel.app',
      'meetifyy-admin-jfqmdqzsm-meetify.vercel.app',
    ]) {
      expect(isNonProductionHost(host), host).toBe(true);
    }
  });

  it('leaves the real production hosts alone', () => {
    for (const host of ['meetifyy.app', 'www.meetifyy.app', 'admin.meetifyy.app']) {
      expect(isNonProductionHost(host), host).toBe(false);
    }
  });
});

/**
 * Two vercel.json files exist — repo root and frontend/ — and only one applies,
 * depending on the Vercel project's Root Directory setting. They had already
 * drifted: the root file proxied /_api and /api/media to the API origin and the
 * frontend file did not, so config.api.proxyPrefix pointed at a route that may
 * or may not exist. Keeping the routing blocks identical makes the deployment
 * behave the same either way.
 */
describe('vercel.json', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const read = (p) => JSON.parse(readFileSync(resolve(repoRoot, p), 'utf8'));
  const root = read('vercel.json');
  const frontend = read('frontend/vercel.json');

  it.each(['redirects', 'rewrites', 'headers'])('has identical %s in both files', (key) => {
    expect(frontend[key]).toEqual(root[key]);
  });

  it('proxies the API prefix the frontend config defaults to', () => {
    const sources = frontend.rewrites.map((r) => r.source);
    expect(sources).toContain('/_api/:path*');
  });

  /**
   * External post sharing depends entirely on this ordering.
   *
   * Vercel applies the first matching rewrite and stops. `/post/:id` has two
   * rules: one conditioned on an unfurler's user agent that proxies to the
   * API's server-rendered metadata document, and the unconditional one that
   * serves the SPA shell. If the shell rule ever ends up first, every crawler
   * receives an empty document with no og: tags, and every shared Meetifyy link
   * previews as a bare URL — silently, because nothing else breaks and no test
   * would otherwise notice.
   */
  describe('crawler routing for /post/:id', () => {
    const postRules = frontend.rewrites
      .map((rule, index) => ({ ...rule, index }))
      .filter((rule) => rule.source === '/post/:id');

    it('sends unfurlers to the metadata document before the SPA fallback', () => {
      const crawlerRules = postRules.filter((rule) =>
        rule.has?.some((condition) => condition.key === 'user-agent'),
      );
      const shell = postRules.find((rule) => rule.destination === '/app.html');

      expect(crawlerRules.length).toBeGreaterThan(0);
      expect(shell).toBeDefined();
      for (const rule of crawlerRules) {
        expect(rule.index).toBeLessThan(shell.index);
        expect(rule.destination).toMatch(/\/api\/share\/post\/:id\/preview$/);
      }
    });

    it('matches the user agents the platforms actually send', () => {
      // Vercel anchors a `has` value, so the pattern must match the WHOLE
      // header. These are real strings from the crawlers' published docs; a
      // pattern that only matched the bare product name would match none of
      // them, and the failure is invisible — the crawler silently receives the
      // SPA shell and the link previews as a bare URL.
      const rule = postRules.find((r) =>
        r.has?.some((c) => c.key === 'user-agent'),
      );
      const pattern = new RegExp(
        `^${rule.has.find((c) => c.key === 'user-agent').value}$`,
      );

      const agents = {
        Facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        WhatsApp: 'WhatsApp/2.23.20.0 A',
        Twitter: 'Twitterbot/1.0',
        LinkedIn: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
        Slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
        Discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
        Telegram: 'TelegramBot (like TwitterBot)',
      };

      for (const [platform, agent] of Object.entries(agents)) {
        expect(pattern.test(agent), platform).toBe(true);
      }
    });

    it('leaves ordinary browsers and Googlebot on the SPA', () => {
      // Googlebot renders JavaScript and should keep receiving the same shell
      // as every other app route, so that what it indexes is decided by the
      // existing SEO configuration rather than by this feature.
      const rule = postRules.find((r) =>
        r.has?.some((c) => c.key === 'user-agent'),
      );
      const pattern = new RegExp(
        `^${rule.has.find((c) => c.key === 'user-agent').value}$`,
      );

      const notCrawlers = [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      ];

      for (const agent of notCrawlers) {
        expect(pattern.test(agent), agent.slice(0, 40)).toBe(false);
      }
    });

    it('still serves a person the SPA shell', () => {
      const shell = postRules.find((rule) => rule.destination === '/app.html');
      expect(shell.has).toBeUndefined();
    });

    it('keeps each environment on its own API', () => {
      // CLAUDE.md rule 2: a development deployment must never reach the
      // production API. Every rewrite this feature adds is either scoped to the
      // dev host and pointed at the dev API, or unscoped and pointed at prod.
      //
      // Note what does NOT depend on this: the card's `og:image` names the
      // API's own origin, read from that deployment's `BACKEND_URL`, so a
      // deployment this table does not enumerate still publishes a correct
      // image URL. Only the crawler document's routing lives here, because
      // reaching the API at all is something the edge has to be told.
      const shareRules = frontend.rewrites.filter(
        (rule) => rule.source.startsWith('/api/share/') || rule.source === '/post/:id',
      );
      for (const rule of shareRules) {
        const devHost = rule.has?.some(
          (condition) => condition.type === 'host' && condition.value === 'dev.meetifyy.app',
        );
        if (devHost) expect(rule.destination).toContain('dev-api.meetifyy.app');
        else if (rule.destination.startsWith('http')) {
          expect(rule.destination).toContain('https://api.meetifyy.app');
        }
      }
    });
  });

  it('serves index.html no-store so every reload sees the newest build', () => {
    const html = frontend.headers.find((h) => h.source === '/index.html');
    const cacheControl = html.headers.find((h) => h.key === 'Cache-Control');
    expect(cacheControl.value).toContain('no-store');
  });
});
