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
  const workerSource = read('src/sw.js');
  const registrationSource = read('src/main.jsx');
  const viteSource = read('vite.config.js');

  it('uses network-first navigation without racing the network against stale HTML', () => {
    expect(workerSource).toContain('new NetworkFirst({');
    expect(workerSource).toContain("cacheName: 'app-shell'");
    expect(workerSource).not.toContain('networkTimeoutSeconds');
  });

  /**
   * The guarantee is that a user is never interrupted — not that a waiting
   * worker can never be promoted. Those were the same thing while promotion was
   * unconditional, so this used to assert the absence of skipWaiting outright.
   *
   * They came apart with installed PWAs: a window that is never fully closed
   * leaves the new worker waiting indefinitely, stranding the user on an old
   * build with no route forward except the hard refresh this whole design
   * exists to abolish. Promotion is now allowed, but only for a page that is
   * hidden and about to reload itself — so what is asserted here is the real
   * invariant: nothing activates or reloads under a visible page.
   */
  it('promotes a waiting worker only while the page is hidden', () => {
    // In the worker, skipWaiting must be reachable ONLY through the message
    // handler — never called at module scope on activation. One occurrence,
    // and it sits directly inside the SKIP_WAITING guard.
    expect(workerSource.match(/self\.skipWaiting\s*\(/g)).toHaveLength(1);
    expect(workerSource).toMatch(/SKIP_WAITING'\s*\)\s*\{\s*self\.skipWaiting\(\);/);

    // In the page, both the promotion and the reload are gated on `hidden`.
    expect(registrationSource).toMatch(
      /if \(document\.visibilityState !== 'hidden'\) return;[\s\S]{0,400}?postMessage\(\{ type: 'SKIP_WAITING' \}\)/,
    );
    expect(registrationSource).toMatch(
      /if \(document\.visibilityState === 'hidden'\) window\.location\.reload\(\)/,
    );
    // No unguarded reload anywhere.
    expect(registrationSource).not.toMatch(/^\s*window\.location\.(reload|replace)\s*\(/m);
  });

  it('waits out a grace period so a brief tab switch never discards page state', () => {
    expect(registrationSource).toMatch(/HIDDEN_GRACE_MS\s*=\s*60_000/);
    expect(registrationSource).toMatch(/Date\.now\(\) - hiddenSince < HIDDEN_GRACE_MS/);
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
