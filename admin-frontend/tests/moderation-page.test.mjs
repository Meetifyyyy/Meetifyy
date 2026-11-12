// Run: node admin-frontend/tests/moderation-page.test.mjs
import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const { JSDOM } = createRequire(new URL('../../frontend/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/reports' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLOptGroupElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const element = React.createElement;
let server, ReportsPage, ConfirmProvider, root, host, client;
let calls = [], listFails = false, statsFail = false, detailFails = false, updateFails = false, detailGate = null, listGate = null, revealFails = false;
let report;
function reset() {
  calls = []; listFails = statsFail = detailFails = updateFails = revealFails = false; detailGate = listGate = null;
  report = { id: 'report-example', targetId: 'post-example', targetType: 'POST', reason: 'HATE_SPEECH', priority: 'HIGH', status: 'PENDING', createdAt: '2026-11-07T08:00:00Z',
    reporter: { username: 'reporter', displayName: 'Example Reporter' }, description: 'Please review this post.', internalNotes: 'Existing notes', resolution: 'Existing outcome', targetContent: { text: '<script>example()</script>', author: { username: 'author' } } };
}
reset();
globalThis.__moderationApi = async (path, options = {}) => {
  calls.push({ path, method: options.method || 'GET', body: options.body });
  if (path === '/admin/reports/stats') {
    if (statsFail) throw new Error('Stats unavailable');
    return { total: 50, byStatus: { PENDING: 22, UNDER_REVIEW: 8, RESOLVED: 15, REJECTED: 5 } };
  }
  if (path.startsWith('/admin/reports?')) {
    if (listGate) await listGate;
    if (listFails) throw new Error('Queue unavailable');
    return { data: [report], meta: { total: 21, totalPages: 2 } };
  }
  if (path === '/admin/reports/report-example/reveal-author') {
    if (revealFails) throw new Error('Audit log unavailable');
    return { author: { id: 'user-secret', username: 'real_author', displayName: 'Real Author', avatar: null } };
  }
  if (path === '/admin/reports/report-example') {
    if (options.method === 'PATCH') {
      if (updateFails) throw new Error('Decision could not be saved');
      report = { ...report, ...JSON.parse(options.body) }; return report;
    }
    if (detailGate) await detailGate;
    if (detailFails) throw new Error('Report detail unavailable');
    return report;
  }
  throw new Error(`Unexpected route: ${path}`);
};
const tick = async (ms = 30) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
const click = async (node) => { assert.ok(node); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await tick(); };
const byText = (scope, text) => Array.from(scope.querySelectorAll('button')).find((node) => node.textContent.trim() === text);
const dialog = () => document.querySelector('[role="dialog"]');
const confirmation = () => document.querySelector('[role="alertdialog"]');
const writes = () => calls.filter(({ method }) => method !== 'GET');
async function input(node, value, wait = 0) {
  await act(async () => {
    const prototype = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true }));
  }); if (wait) await tick(wait);
}
async function render() {
  host = document.createElement('div'); host.className = 'admin-content-surface'; document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  await act(async () => root.render(element(QueryClientProvider, { client }, element(ConfirmProvider, null, element(ReportsPage))))); await tick();
}
const openReview = async () => { await click(host.querySelector('.moderation-review-button')); await tick(); };
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{
    name: 'moderation-fixture', enforce: 'pre',
    resolveId(source) { if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0moderation-api'; },
    load(id) { if (id === '\0moderation-api') return 'export const apiRequest = (...args) => globalThis.__moderationApi(...args); export const getMediaUrl = () => null;'; },
  }] });
  ({ ReportsPage } = await server.ssrLoadModule('/src/pages/ReportsPage.tsx'));
  ({ ConfirmProvider } = await server.ssrLoadModule('/src/components/ConfirmProvider.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); reset(); });
after(async () => { await server?.close(); dom.window.close(); delete globalThis.__moderationApi; });

test('queue summaries use server totals, and enums have readable interface labels', async () => {
  await render();
  assert.deepEqual(Array.from(host.querySelectorAll('.moderation-summary dd'), (node) => node.textContent), ['22', '8', '15', '5']);
  assert.match(host.querySelector('.moderation-table').textContent, /Hate speech/);
  assert.doesNotMatch(host.querySelector('.moderation-table').textContent, /HATE_SPEECH|@undefined/);
  assert.equal(writes().length, 0);
});

test('status, priority and debounced search reset pagination and preserve API enum values', async () => {
  await render(); await click(byText(host, 'Next'));
  assert.ok(calls.some(({ path }) => path.endsWith('page=2')));
  await click(byText(host.querySelector('.moderation-status-tabs'), 'Under review'));
  assert.ok(calls.at(-1).path.includes('status=UNDER_REVIEW')); assert.ok(calls.at(-1).path.includes('page=1'));
  const select = host.querySelector('.moderation-priority-filter select');
  await act(async () => { select.value = 'CRITICAL'; select.dispatchEvent(new Event('change', { bubbles: true })); }); await tick();
  assert.ok(calls.at(-1).path.includes('priority=CRITICAL'));
  await input(host.querySelector('input[type="search"]'), '@reporter test', 350); await tick();
  assert.ok(calls.at(-1).path.includes('search=%40reporter+test'));
});

test('detail requests open a loading dialog immediately and can be closed before completing', async () => {
  let release; detailGate = new Promise((resolve) => { release = resolve; });
  await render(); await openReview();
  assert.match(dialog().textContent, /Loading report details/);
  assert.ok(dialog().querySelector('.analytics-loading-spinner'));
  await click(dialog().querySelector('.dialog-close'));
  await act(async () => release()); await tick();
  assert.equal(dialog(), null); assert.equal(writes().length, 0);
});

test('detail errors have an inline retry and preserve existing notes after recovery', async () => {
  detailFails = true; await render(); await openReview();
  assert.match(dialog().querySelector('[role="alert"]').textContent, /Report detail unavailable/);
  detailFails = false; await click(byText(dialog(), 'Try again'));
  assert.equal(dialog().querySelector('#report-admin-notes').value, 'Existing notes');
  assert.equal(dialog().querySelector('#report-resolution').value, 'Existing outcome');
});

test('review content is escaped, missing content is explained, and keyboard focus stays in the dialog', async () => {
  await render(); const opener = host.querySelector('.moderation-review-button'); opener.focus(); await openReview();
  const review = dialog();
  assert.equal(review.querySelector('.moderation-content-text').textContent, '<script>example()</script>');
  assert.equal(review.querySelector('script'), null);
  assert.ok(document.activeElement === review.querySelector('.dialog-close'), `Expected dialog close focus, got ${document.activeElement?.tagName}: ${document.activeElement?.getAttribute('aria-label')}`);
  byText(review, 'Resolve report').focus();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
  assert.ok(document.activeElement === review.querySelector('.dialog-close'), `Expected dialog close focus, got ${document.activeElement?.tagName}: ${document.activeElement?.getAttribute('aria-label')}`);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(dialog(), null); assert.ok(document.activeElement === opener, 'Expected focus to return to the Review button');
  report = { ...report, targetContent: null }; await openReview();
  assert.match(dialog().textContent, /content is no longer available/);
});

test('resolve waits for confirmation, saves notes without enforcing content, and closes cleanly', async () => {
  await render(); await openReview();
  await input(dialog().querySelector('#report-admin-notes'), 'Private review note');
  await input(dialog().querySelector('#report-resolution'), 'Decision recorded');
  await click(byText(dialog(), 'Resolve report'));
  assert.equal(writes().length, 0);
  assert.match(confirmation().textContent, /does not automatically remove content/);
  await click(byText(confirmation(), 'Resolve report')); await tick();
  assert.deepEqual(writes().map(({ path, body }) => [path, JSON.parse(body)]), [['/admin/reports/report-example', { status: 'RESOLVED', resolution: 'Decision recorded', internalNotes: 'Private review note' }]]);
  assert.equal(dialog(), null); assert.equal(confirmation(), null);
  assert.equal(document.body.style.overflow, ''); assert.equal(host.style.overflow, '');
  assert.ok(calls.filter(({ path }) => path === '/admin/reports/stats').length > 1);
});

test('dismissal cancellation retains the editor; confirmation sends REJECTED', async () => {
  await render(); await openReview();
  await click(byText(dialog(), 'Dismiss report'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.ok(dialog()); assert.equal(writes().length, 0);
  await click(byText(dialog(), 'Dismiss report')); await click(byText(confirmation(), 'Dismiss report'));
  assert.equal(JSON.parse(writes()[0].body).status, 'REJECTED');
});

test('failed decisions retain the confirmation and unsaved fields for retry', async () => {
  updateFails = true; await render(); await openReview();
  await input(dialog().querySelector('#report-resolution'), 'Keep this outcome');
  await click(byText(dialog(), 'Resolve report')); await click(byText(confirmation(), 'Resolve report'));
  assert.match(confirmation().textContent, /Decision could not be saved/);
  assert.equal(dialog().querySelector('#report-resolution').value, 'Keep this outcome');
  updateFails = false; await click(byText(confirmation(), 'Resolve report'));
  assert.equal(dialog(), null); assert.equal(confirmation(), null);
});

test('queue and summary failures are explicit and can recover independently', async () => {
  listFails = statsFail = true; await render();
  assert.deepEqual(Array.from(host.querySelectorAll('.moderation-summary dd'), (node) => node.textContent), ['—', '—', '—', '—']);
  assert.equal(host.querySelectorAll('[role="alert"]').length, 2);
  assert.match(host.querySelector('.moderation-empty').textContent, /Reports unavailable/);
  listFails = false; await click(byText(host.querySelectorAll('[role="alert"]')[1], 'Try again'));
  assert.ok(host.querySelector('.moderation-table')); assert.equal(host.querySelectorAll('[role="alert"]').length, 1);
});


test('pending queues show the shared loading spinner without a false empty state', async () => {
  let release;
  listGate = new Promise((resolve) => { release = resolve; });
  await render();
  assert.match(host.querySelector('.admin-loading-state').textContent, /Loading reports/);
  assert.ok(host.querySelector('.analytics-loading-spinner.spin'));
  assert.equal(host.querySelector('.moderation-empty'), null);
  await act(async () => release()); await tick();
  assert.ok(host.querySelector('.moderation-table'));
});

const confession = () => { report = { ...report, targetType: 'CONFESSION', targetContent: { id: 'c1', content: 'I did it', text: 'I did it', profile: { handle: 'ghost_42' } } }; };
const reveals = () => writes().filter(({ path }) => path.endsWith('/reveal-author'));

test('a confession report shows the handle and hides the author until revealed', async () => {
  confession(); await render(); await openReview();
  assert.match(dialog().querySelector('.moderation-author').textContent, /ghost_42/);
  assert.doesNotMatch(dialog().textContent, /real_author|Real Author|user-secret/);
  assert.ok(byText(dialog(), 'Reveal author'));
  assert.equal(reveals().length, 0);
});

test('other report types have no reveal control', async () => {
  await render(); await openReview();
  assert.equal(dialog().querySelector('.moderation-author'), null);
  assert.equal(byText(dialog(), 'Reveal author'), undefined);
});

test('revealing needs a reason of 10 to 500 characters, sends it trimmed, then shows the author', async () => {
  confession(); await render(); await openReview();
  await click(byText(dialog(), 'Reveal author'));
  const submit = () => byText(dialog(), 'Reveal author');
  assert.equal(submit().disabled, true);
  await input(dialog().querySelector('#reveal-author-reason'), 'too short');
  assert.equal(submit().disabled, true);
  await input(dialog().querySelector('#reveal-author-reason'), '          '); assert.equal(submit().disabled, true);
  await input(dialog().querySelector('#reveal-author-reason'), '  Threats against a named student  ');
  assert.equal(submit().disabled, false);
  await click(submit());
  assert.deepEqual(reveals().map(({ path, method, body }) => [path, method, JSON.parse(body)]), [['/admin/reports/report-example/reveal-author', 'POST', { reason: 'Threats against a named student' }]]);
  assert.match(dialog().querySelector('.moderation-author').textContent, /Real Author/);
  assert.match(dialog().querySelector('.moderation-author').textContent, /@real_author/);
  assert.equal(dialog().querySelector('#reveal-author-reason'), null);
  assert.doesNotMatch(dialog().querySelector('pre').textContent, /real_author/);
});

test('a failed reveal shows the error, keeps the reason, and does not show the author', async () => {
  revealFails = true; confession(); await render(); await openReview();
  await click(byText(dialog(), 'Reveal author'));
  await input(dialog().querySelector('#reveal-author-reason'), 'Threats against a named student');
  await click(byText(dialog(), 'Reveal author'));
  assert.match(dialog().querySelector('.moderation-reveal-form [role="alert"]').textContent, /Audit log unavailable/);
  assert.equal(dialog().querySelector('#reveal-author-reason').value, 'Threats against a named student');
  assert.doesNotMatch(dialog().textContent, /Real Author|real_author/);
  revealFails = false; await click(byText(dialog(), 'Reveal author'));
  assert.match(dialog().querySelector('.moderation-author').textContent, /Real Author/);
});

test('cancelling the reveal form discards the reason without closing the review', async () => {
  confession(); await render(); await openReview();
  await click(byText(dialog(), 'Reveal author'));
  await input(dialog().querySelector('#reveal-author-reason'), 'Threats against a named student');
  await act(async () => dialog().querySelector('#reveal-author-reason').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await tick();
  assert.ok(dialog()); assert.equal(dialog().querySelector('#reveal-author-reason'), null);
  assert.equal(reveals().length, 0);
  await click(byText(dialog(), 'Reveal author'));
  assert.equal(dialog().querySelector('#reveal-author-reason').value, '');
});
