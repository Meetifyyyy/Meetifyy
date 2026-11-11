// Run: node admin-frontend/tests/analytics-page.test.mjs
import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const { JSDOM } = createRequire(new URL('../../frontend/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/analytics' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLOptGroupElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const element = React.createElement;
let server, AnalyticsPage, root, host, client;
let calls = [], failInfra = false, failSlow = false, failErrors = false, captureEnabled = true, zeroSlow = false, gate = null;
const stamp = '2026-11-07T08:00:00Z';
globalThis.__analyticsPageApi = async (path) => {
  calls.push(path); if (gate) await gate;
  if (path === '/admin/analytics/infrastructure') {
    if (failInfra) throw new Error('Infrastructure probe failed');
    return { generatedAt: stamp, services: [
      { name: 'Redis', state: 'UP', latencyMs: 0, metrics: [{ label: 'Memory', value: 0, unit: 'bytes', limit: 100 }, { label: 'Connections', value: 99, unit: 'count', limit: 100 }] },
      { name: 'Email', state: 'DOWN', detail: 'Provider unavailable', metrics: [] },
      { name: 'Missing provider', state: 'NOT_CONFIGURED', metrics: [] },
    ], unconfigured: [{ name: 'Missing provider', requires: ['PROVIDER_ACCESS'] }] };
  }
  const query = new URL(`http://localhost${path}`).searchParams;
  if (path.startsWith('/admin/analytics/slow-requests')) {
    if (failSlow) throw new Error('Request log unavailable');
    return { data: zeroSlow ? [] : [{ id: 'slow1', route: '/api/campus/:campusId', path: '/api/campus/example', method: 'GET', statusCode: 503, durationMs: 2500, bytesOut: 0, userId: 'user-example', adminId: null, occurredAt: stamp }],
      meta: { total: zeroSlow ? 0 : 21, totalPages: zeroSlow ? 0 : 2, thresholdMs: 500, retentionDays: 7, windowStart: stamp, slowestMs: zeroSlow ? 0 : 2500, averageMs: zeroSlow ? 0 : 850, surfaceCounts: { all: 21, admin: 20, app: 1 } },
      topRoutes: zeroSlow ? [] : [{ route: '/api/campus/:campusId', count: 9, avgMs: 800, maxMs: 2500 }] };
  }
  if (path.startsWith('/admin/analytics/error-logs')) {
    if (failErrors) throw new Error('Error log unavailable');
    return { rows: [{ id: 'error1', route: '/api/failed/:id', path: '/api/failed/example', method: 'POST', statusCode: 500, severity: 'UNEXPECTED', message: '<img src=x onerror=bad()>', name: 'ExampleFailure', stack: 'ExampleFailure\n  at service.ts:12', requestId: 'request-example', userId: null, adminId: 'admin-example', ip: '127.0.0.1', userAgent: 'Example client', occurredAt: stamp }],
      pagination: { page: Number(query.get('page') || 1), pages: 2, total: 21, limit: 20 },
      summary: { total: 21, unexpected: 19, expected: 2, retentionDays: 7, oldestRecorded: stamp, captureEnabled, clientErrorsCaptured: captureEnabled },
      topRoutes: [{ route: '/api/failed/:id', count: 7, lastSeen: stamp }] };
  }
  throw new Error(`Unexpected API route: ${path}`);
};
const tick = async (ms = 30) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
const click = async (node) => { assert.ok(node); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await tick(); };
const byText = (scope, text) => Array.from(scope.querySelectorAll('button')).find((node) => node.textContent.trim() === text);
async function input(node, value) {
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
  await tick(340); await tick();
}
async function render() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  await act(async () => root.render(element(QueryClientProvider, { client }, element(AnalyticsPage)))); await tick();
}
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{
    name: 'analytics-page-fixture', enforce: 'pre',
    resolveId(source) { if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0analytics-api'; },
    load(id) { if (id === '\0analytics-api') return 'export const apiRequest = (...args) => globalThis.__analyticsPageApi(...args);'; },
  }] });
  ({ AnalyticsPage } = await server.ssrLoadModule('/src/pages/AnalyticsPage.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); calls = []; failInfra = failSlow = failErrors = zeroSlow = false; captureEnabled = true; gate = null; });
after(async () => { await server?.close(); dom.window.close(); delete globalThis.__analyticsPageApi; });

test('service summaries distinguish unavailable and unconfigured providers without double counting', async () => {
  await render();
  assert.deepEqual(Array.from(host.querySelectorAll('.analytics-overview-grid dd'), (node) => node.textContent), ['1', '1', '1']);
  assert.equal(host.querySelectorAll('.analytics-service-card').length, 3);
  assert.match(host.querySelector('.analytics-service-card.state-down').textContent, /No measurements/);
  assert.match(host.querySelector('.analytics-service-card.state-not_configured').textContent, /Not configured/);
  assert.match(host.querySelector('.analytics-unconfigured').textContent, /PROVIDER_ACCESS/);
});

test('zero measurements remain zero and usage bars expose the measured ratio', async () => {
  await render();
  const card = host.querySelector('.analytics-service-card.state-up');
  assert.match(card.textContent, /Response 0 ms/); assert.match(card.textContent, /0 B/);
  const memory = card.querySelector('[aria-label="Memory"]');
  assert.equal(memory.getAttribute('aria-valuenow'), '0');
  assert.equal(memory.firstElementChild.style.width, '0%');
  assert.equal(card.querySelector('[aria-label="Connections"]').getAttribute('aria-valuenow'), '99');
});

test('refresh probes services again without re-requesting the logs', async () => {
  await render(); const beforeCalls = calls.length;
  await click(host.querySelector('[aria-label="Refresh service metrics"]'));
  assert.deepEqual(calls.slice(beforeCalls), ['/admin/analytics/infrastructure']);
});

test('slow-request pagination and surface/route filters reset to a valid first page', async () => {
  await render(); const section = host.querySelector('.analytics-performance-section');
  await click(byText(section, 'Next'));
  assert.ok(calls.some((path) => path.includes('slow-requests?page=2')));
  await click(Array.from(section.querySelectorAll('.analytics-traffic-tabs button')).find((node) => node.textContent.includes('Admin portal')));
  assert.ok(calls.at(-1).includes('page=1')); assert.ok(calls.at(-1).includes('surface=admin'));
  const search = section.querySelector('input[type="search"]'); await input(search, '/api/campus?name=x');
  assert.ok(calls.at(-1).includes('route=%2Fapi%2Fcampus%3Fname%3Dx'));
  await click(section.querySelector('[aria-label="Clear route filter"]'));
  assert.equal(document.activeElement, search);
});

test('zero slow-request aggregates are rendered as measured zero, not missing data', async () => {
  zeroSlow = true; await render();
  assert.deepEqual(Array.from(host.querySelectorAll('.analytics-request-summary dd'), (node) => node.textContent), ['0', '0 ms', '0 ms', '500 ms']);
  assert.match(host.querySelector('.analytics-performance-section .analytics-empty').textContent, /No matching/);
});

test('error context has an explicit accessible toggle and renders error text safely', async () => {
  await render(); const section = host.querySelector('.analytics-error-section');
  assert.equal(section.querySelector('.error-cell-message').textContent, '<img src=x onerror=bad()>');
  assert.equal(section.querySelector('.error-cell-message img'), null);
  const control = section.querySelector('.analytics-context-button');
  assert.equal(control.getAttribute('aria-expanded'), 'false'); await click(control);
  assert.equal(control.getAttribute('aria-expanded'), 'true');
  const context = document.getElementById(control.getAttribute('aria-controls')); assert.ok(context);
  assert.match(context.textContent, /request-example/); assert.match(context.textContent, /Example client/);
  assert.match(context.querySelector('pre').textContent, /service.ts:12/);
  await click(control); assert.equal(document.getElementById(control.getAttribute('aria-controls')), null);
});

test('error filters use debounced search and severity while preserving pagination contracts', async () => {
  await render(); const section = host.querySelector('.analytics-error-section');
  await click(byText(section, 'Next')); assert.ok(calls.at(-1).includes('error-logs?page=2'));
  await input(section.querySelector('input[type="search"]'), 'service error');
  assert.ok(calls.at(-1).includes('page=1')); assert.ok(calls.at(-1).includes('search=service+error'));
  const select = section.querySelector('select');
  await act(async () => { select.value = 'UNEXPECTED'; select.dispatchEvent(new Event('change', { bubbles: true })); }); await tick();
  assert.ok(calls.at(-1).includes('severity=UNEXPECTED'));
});

test('disabled capture stays visible and does not imply a complete client-error count', async () => {
  captureEnabled = false; await render();
  assert.match(host.querySelector('.analytics-capture-notice').textContent, /New errors are not being recorded/);
  assert.equal(host.querySelectorAll('.analytics-error-summary .analytics-stat').length, 3);
});

test('query failures show explicit retry states instead of healthy or empty results', async () => {
  failInfra = failSlow = failErrors = true; await render();
  assert.equal(host.querySelectorAll('.analytics-error-notice[role="alert"]').length, 3);
  assert.deepEqual(Array.from(host.querySelectorAll('.analytics-overview-grid dd'), (node) => node.textContent), ['—', '—', '—']);
  assert.match(host.querySelector('.analytics-performance-section .analytics-empty').textContent, /unavailable/);
  assert.match(host.querySelector('.analytics-error-section .analytics-empty').textContent, /unavailable/);
  failInfra = false; await click(byText(host.querySelector('.analytics-error-notice'), 'Try again'));
  assert.equal(host.querySelectorAll('.analytics-overview-grid dd')[0].textContent, '1');
});

test('pending sections share the Analytics services spinner until their data arrives', async () => {
  let release; gate = new Promise((resolve) => { release = resolve; }); await render();
  assert.equal(host.querySelectorAll('.admin-loading-state .analytics-loading-spinner.spin').length, 3);
  await act(async () => release()); await tick();
  assert.equal(host.querySelector('.admin-loading-state'), null);
});
