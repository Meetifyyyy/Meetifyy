import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const frontendRoot = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.resolve(frontendRoot, relativePath), 'utf8');

const vercelConfigs = [
  JSON.parse(read('vercel.json')),
  JSON.parse(read('../vercel.json')),
];

const headersFor = (config, source) => {
  const rule = config.headers.find((entry) => entry.source === source);
  expect(rule, `missing Vercel header rule for ${source}`).toBeDefined();
  return Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
};

describe('deployment cache headers', () => {
  it.each(vercelConfigs)('never stores an app-shell response at the browser or CDN', (config) => {
    const documentRoutes = [
      '/',
      '/index.html',
      '/((?!assets/|fonts/|icons/|favicon\\.png|.*\\.[a-zA-Z0-9]+$).*)',
    ];

    for (const source of documentRoutes) {
      const headers = headersFor(config, source);
      expect(headers['Cache-Control']).toContain('no-store');
      expect(headers['CDN-Cache-Control']).toBe('no-store');
      expect(headers['Vercel-CDN-Cache-Control']).toBe('no-store');
    }
  });

  it.each(vercelConfigs)('serves the worker uncached and hashed assets as immutable', (config) => {
    const workerHeaders = headersFor(config, '/sw.js');
    expect(workerHeaders['Cache-Control']).toContain('no-store');
    expect(workerHeaders['CDN-Cache-Control']).toBe('no-store');
    expect(workerHeaders['Vercel-CDN-Cache-Control']).toBe('no-store');

    expect(headersFor(config, '/assets/(.*)')['Cache-Control']).toBe(
      'public, max-age=31536000, immutable',
    );
  });
});

describe('service-worker update lifecycle', () => {
  /**
   * Comments are stripped before matching.
   *
   * These assertions are about what the code DOES, and several of them are
   * negative — "this must not appear". A comment explaining why something was
   * removed necessarily names the thing it removed, so matching raw source
   * makes a correct explanation fail the test that the explanation is about.
   */
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

  const workerSource = stripComments(read('src/sw.js'));
  const registrationSource = stripComments(read('src/main.jsx'));
  const viteSource = read('vite.config.js');

  it('uses network-first navigation without racing the network against stale HTML', () => {
    expect(workerSource).toContain('new NetworkFirst({');
    expect(workerSource).toContain("cacheName: 'app-shell'");
    expect(workerSource).not.toContain('networkTimeoutSeconds');
  });

  /**
   * Updates happen at ONE checkpoint: the launch screen.
   *
   * This used to assert the opposite invariant — that a waiting worker could be
   * promoted, but only while the page was hidden and about to reload itself.
   * That existed because `sw.js` does not call `skipWaiting()` at install (a new
   * worker activating under a running page lets Workbox delete the precache
   * that page is still loading lazy chunks from), so an installed PWA that is
   * never fully closed could sit on an old build for days.
   *
   * The launch-time version gate in index.html replaced it, and the promotion
   * was removed rather than kept alongside: reloading a hidden tab is still a
   * reload nobody asked for, and it discarded anything unsaved in the page. The
   * rule now is that an open session is left completely alone, and the gate is
   * the only thing that ever promotes a worker.
   */
  it('never promotes a worker or reloads from inside a running session', () => {
    // skipWaiting must still be reachable ONLY through the message handler —
    // never at module scope, where it would activate under a live page.
    expect(workerSource.match(/self\.skipWaiting\s*\(/g)).toHaveLength(1);
    expect(workerSource).toMatch(/SKIP_WAITING'\s*\)\s*\{\s*self\.skipWaiting\(\);/);

    // The page no longer promotes anything, on any condition.
    expect(registrationSource).not.toMatch(/SKIP_WAITING/);
    // And no longer reloads itself, hidden or otherwise.
    expect(registrationSource).not.toMatch(/window\.location\.(reload|replace)\s*\(/);
  });

  it('does not poll for new deployments mid-session', () => {
    // Nothing looks for a new build while the app is running, so nothing can
    // act on finding one. The check belongs to the launch screen alone.
    expect(registrationSource).not.toMatch(/setInterval/);
    expect(registrationSource).not.toMatch(/registration\.update\(\)/);
    expect(registrationSource).not.toMatch(/HIDDEN_GRACE_MS/);
  });

  it('still registers the worker, bypassing the HTTP cache for sw.js', () => {
    // Without `updateViaCache: 'none'` the browser may answer the /sw.js
    // request from its own cache, and a new worker is never discovered — which
    // would leave the launch gate as the only update path with nothing to
    // promote when it fires.
    expect(registrationSource).toMatch(/updateViaCache: 'none'/);
  });

  it('does not precache index.html but does precache hashed build assets', () => {
    expect(viteSource).toContain("globPatterns: ['**/*.{js,css,png,webp,svg,woff2}']");
    expect(viteSource).not.toContain("globPatterns: ['**/*.{js,css,html");
  });

  it('contains no deployment polling or cache-busting reload workaround', () => {
    const appSource = read('src/App.jsx');
    const boundarySource = read('src/shared/components/ErrorBoundary.jsx');
    const combined = `${appSource}\n${boundarySource}`;

    expect(combined).not.toContain('page_reloaded_on_chunk_error');
    expect(combined).not.toContain("searchParams.set('_v'");
    expect(combined).not.toContain('caches.delete');
    expect(combined).not.toContain('getRegistrations');
  });
});
