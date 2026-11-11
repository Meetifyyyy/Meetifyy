// Run: node admin-frontend/tests/verification-page.test.mjs
import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const { JSDOM } = createRequire(new URL('../../frontend/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/verification' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLOptGroupElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const el = React.createElement;
let server, VerificationPage, ConfirmProvider, root, host, client;
let records, calls, listFails, updateFails, listGate, updateGate;
const makeRequest = (id = 'request-1') => ({ id, user: { id: 'student-1', displayName: 'Example Student', username: 'example', email: 'student@campus.test' }, status: 'PENDING', method: 'LIVE_SELFIE', attemptNumber: 2, createdAt: '2026-11-08T10:00:00Z', selfieMedia: null, idCardMedia: null,
  previousAttempts: [{ id: `previous-${id}`, attemptNumber: 1, status: 'REJECTED', rejectionReason: '<b>Please use a clearer photo</b>', createdAt: '2026-11-07T10:00:00Z', reviewedAt: '2026-11-07T11:00:00Z' }] });
function reset() { records = [makeRequest()]; calls = []; listFails = updateFails = false; listGate = updateGate = null; }
reset();
globalThis.__verificationPageApi = async (path, options = {}) => {
  const method = options.method || 'GET'; const body = options.body && JSON.parse(options.body); calls.push({ path, method, body });
  if (method === 'PATCH') { if (updateGate) await updateGate; if (updateFails) throw new Error('Decision unavailable'); const id = path.split('/').at(-2); const record = records.find((record) => record.id === id); Object.assign(record, { status: body.status, rejectionReason: body.adminNotes, reviewedAt: '2026-11-10T10:00:00Z' }); return record; }
  const url = new URL(path, 'http://localhost');
  if (url.pathname === '/admin/verification/requests') {
    if (listGate) await listGate; if (listFails) throw new Error('Queue unavailable');
    const status = url.searchParams.get('status'); const matching = records.filter((record) => !status || record.status === status); const offset = Number(url.searchParams.get('offset') || 0); const limit = Number(url.searchParams.get('limit') || 20);
    return { total: matching.length, requests: matching.slice(offset, offset + limit).map((record) => ({ ...record })) };
  }
  if (path.endsWith('/documents')) return { idCard: { url: 'https://private.invalid/id-fresh.jpg' }, selfie: { url: 'https://private.invalid/selfie-fresh.jpg' } };
  throw new Error(`Unexpected request ${path}`);
};
const tick = async (ms = 40) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const click = async (node) => { assert.ok(node, 'Expected a control'); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await tick(); };
const button = (scope, text) => Array.from(scope.querySelectorAll('button')).find((node) => node.textContent.trim() === text);
const dialog = () => document.querySelector('.verification-reject-dialog');
const confirmation = () => document.querySelector('[role="alertdialog"]');
const writes = () => calls.filter(({ method }) => method !== 'GET');
async function input(node, value) { await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }); await tick(); }
async function render() {
  host = document.createElement('div'); host.id = 'root'; host.className = 'admin-content-surface'; document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  await act(async () => root.render(el(QueryClientProvider, { client }, el(ConfirmProvider, null, el(VerificationPage))))); await tick();
}
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{ name: 'verification-page-fixture', enforce: 'pre', resolveId(source) { if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0verification-page-api'; }, load(id) { if (id === '\0verification-page-api') return 'export const apiRequest = (...args) => globalThis.__verificationPageApi(...args); export const getMediaUrl = () => null;'; } }] });
  ({ VerificationPage } = await server.ssrLoadModule('/src/pages/VerificationPage.tsx'));
  ({ ConfirmProvider } = await server.ssrLoadModule('/src/components/ConfirmProvider.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); reset(); });
after(async () => { await server?.close(); dom.window.close(); delete globalThis.__verificationPageApi; });

test('queue uses server totals and status filters reset the offset without fetching all private submissions', async () => {
  records.push({ ...makeRequest('request-2'), status: 'VERIFIED' }); await render();
  assert.equal(host.querySelector('.verification-overview-count strong').textContent, '1');
  await click(button(host.querySelector('.verification-status-filters'), 'All requests'));
  assert.equal(host.querySelector('.verification-overview-count strong').textContent, '2');
  const allCall = calls.at(-1); assert.ok(!new URL(allCall.path, 'http://localhost').searchParams.has('status')); assert.match(allCall.path, /limit=20&offset=0/);
  await click(button(host.querySelector('.verification-status-filters'), 'Verified')); assert.equal(host.querySelectorAll('.verification-actions').length, 0); assert.ok(calls.at(-1).path.includes('status=VERIFIED')); assert.equal(writes().length, 0);
});
test('server pagination reaches the next page and clamps after its last pending request is approved', async () => {
  records = Array.from({ length: 21 }, (_, index) => makeRequest(`request-${index + 1}`)); await render(); await click(button(host, 'Next'));
  assert.ok(calls.some(({ path }) => path.includes('offset=20'))); assert.equal(host.querySelectorAll('.verification-card').length, 1);
  await click(button(host.querySelector('.verification-actions'), 'Approve')); assert.equal(writes().length, 0);
  await click(button(confirmation(), 'Approve')); await tick();
  assert.equal(writes()[0].path, '/admin/verification/requests/request-21/status'); assert.deepEqual(writes()[0].body, { status: 'VERIFIED' });
  assert.match(host.querySelector('.verification-notice').textContent, /approved/); assert.equal(host.querySelector('.verification-overview-count strong').textContent, '20');
  assert.ok(calls.at(-1).path.includes('offset=0')); assert.equal(host.querySelectorAll('.verification-card').length, 20);
});
test('loading uses the shared spinner and queue failures offer retry instead of an empty-success state', async () => {
  let release; listGate = new Promise((resolve) => { release = resolve; }); await render(); assert.match(host.querySelector('.admin-loading-state').textContent, /Loading verification/);
  listFails = true; release(); await tick(); assert.match(host.querySelector('.verification-empty').textContent, /Queue unavailable/); assert.doesNotMatch(host.textContent, /All caught up/);
  listFails = false; await click(button(host, 'Try again')); assert.ok(host.querySelector('.verification-card'));
});
test('live and legacy documents are shown according to the actual submission method', async () => {
  records[0].selfieMedia = { url: 'https://private.invalid/selfie.jpg' }; await render();
  assert.equal(host.querySelectorAll('.verification-media-card').length, 1); assert.equal(host.querySelector('img').src, 'https://private.invalid/selfie.jpg');
  records[0].method = 'LIVE_GOVERNMENT_ID'; records[0].idCardMedia = { url: 'https://private.invalid/id.jpg' }; await click(button(host, 'Refresh requests'));
  assert.equal(host.querySelectorAll('.verification-media-card').length, 1); assert.equal(host.querySelector('img').src, 'https://private.invalid/id.jpg');
  records[0].method = null; await click(button(host, 'Refresh requests')); assert.equal(host.querySelectorAll('.verification-media-card').length, 2);
});
test('attempt history preserves plain text and missing identity fields never render undefined handles', async () => {
  records[0].user = null; await render(); assert.match(host.querySelector('.verification-person-name').textContent, /Student/); assert.doesNotMatch(host.textContent, /@undefined|@null/);
  await click(host.querySelector('.verification-history summary')); assert.ok(host.querySelector('.verification-history').open);
  assert.equal(host.querySelector('.verification-history b'), null); assert.match(host.querySelector('.verification-history').textContent, /<b>Please use a clearer photo<\/b>/);
});
test('approval is confirmed and a failed decision remains visible inside the confirmation', async () => {
  await render(); await click(button(host.querySelector('.verification-actions'), 'Approve')); assert.equal(writes().length, 0);
  updateFails = true; await click(button(confirmation(), 'Approve')); assert.ok(confirmation()); assert.match(confirmation().textContent, /Decision unavailable/); assert.ok(host.querySelector('.verification-actions'));
});
test('rejection requires a reason and preserves it on failure before retrying with the trimmed payload', async () => {
  await render(); await click(button(host, 'Reject'));
  assert.equal(button(dialog(), 'Confirm rejection').disabled, true); assert.equal(dialog().querySelector('textarea').maxLength, 500);
  await input(dialog().querySelector('textarea'), '  Please send a clearer photo.  '); updateFails = true; await click(button(dialog(), 'Confirm rejection'));
  assert.ok(dialog()); assert.match(dialog().querySelector('[role="alert"]').textContent, /Decision unavailable/); assert.equal(dialog().querySelector('textarea').value, '  Please send a clearer photo.  ');
  assert.deepEqual(writes()[0].body, { status: 'REJECTED', adminNotes: 'Please send a clearer photo.' });
  updateFails = false; await click(button(dialog(), 'Confirm rejection')); assert.equal(dialog(), null); assert.match(host.textContent, /All caught up/);
});
test('rejection editor contains keyboard focus, restores it on Escape, and sends nothing on cancellation', async () => {
  await render(); const opener = button(host, 'Reject'); opener.focus(); await click(opener);
  assert.ok(document.activeElement === dialog().querySelector('textarea'), 'Focus should enter the reason field');
  const first = dialog().querySelector('button'); first.focus(); await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  assert.ok(dialog().contains(document.activeElement) && document.activeElement !== first, 'Focus should wrap inside the editor');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await tick();
  assert.equal(dialog(), null); assert.ok(document.activeElement === opener, 'Closing should restore focus to Reject'); assert.equal(writes().length, 0);
});
test('a rejection in progress cannot be dismissed or submitted again', async () => {
  await render(); await click(button(host, 'Reject')); await input(dialog().querySelector('textarea'), 'Please retake the photo.');
  let release; updateGate = new Promise((resolve) => { release = resolve; }); await click(button(dialog(), 'Confirm rejection'));
  assert.equal(dialog().getAttribute('aria-busy'), 'true'); assert.equal(dialog().querySelector('textarea').disabled, true);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await click(document.querySelector('.verification-reject-backdrop')); assert.ok(dialog()); assert.equal(writes().length, 1);
  release(); await tick(); assert.equal(dialog(), null);
});
