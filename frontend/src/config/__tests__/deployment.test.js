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

  it('serves index.html no-store so every reload sees the newest build', () => {
    const html = frontend.headers.find((h) => h.source === '/index.html');
    const cacheControl = html.headers.find((h) => h.key === 'Cache-Control');
    expect(cacheControl.value).toContain('no-store');
  });
});
