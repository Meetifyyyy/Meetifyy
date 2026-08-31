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

  it('does not force waiting workers to activate or reload controlled clients', () => {
    expect(workerSource).not.toMatch(/\bself\.skipWaiting\s*\(/);
    expect(registrationSource).not.toContain('SKIP_WAITING');
    expect(registrationSource).not.toContain('controllerchange');
    expect(registrationSource).not.toMatch(/location\.(reload|replace)\s*\(/);
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
