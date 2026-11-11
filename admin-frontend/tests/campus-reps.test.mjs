// Run: node admin-frontend/tests/campus-reps.test.mjs
import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const { JSDOM } = createRequire(new URL('../../frontend/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/campus-reps' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLOptGroupElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const element = React.createElement;
let server, CampusRepsPage, ConfirmProvider, root, host, client;
let calls = [], rosterFails = false, searchFails = false, mutationFails = false, reps, candidates;
let rosterGate = null;
function reset() {
  calls = []; rosterFails = searchFails = mutationFails = false; rosterGate = null;
  reps = [
    { id: 'rep1', username: 'first', displayName: 'First Rep', email: 'first@example.invalid', isCampusRep: true, college: { id: 'campus1', name: 'Shared name' } },
    { id: 'rep2', username: 'second', displayName: 'Second Rep', email: 'second@example.invalid', isCampusRep: true, college: { id: 'campus2', name: 'Shared name' } },
  ];
  candidates = [
    { id: 'candidate1', username: 'available', displayName: 'Available Student', isCampusRep: false, college: { id: 'campus3', name: 'Third Campus' } },
    { id: 'candidate2', username: 'occupied', displayName: 'Occupied Student', isCampusRep: false, college: { id: 'campus1', name: 'Shared name' } },
    { id: 'candidate3', username: 'no-campus', displayName: 'No Campus', isCampusRep: false, college: null },
    reps[1],
  ];
}
reset();
globalThis.__campusRepsApi = async (path, options = {}) => {
  calls.push({ path, method: options.method || 'GET', body: options.body });
  if (path === '/admin/users/campus-reps') {
    if (rosterGate) await rosterGate;
    if (rosterFails) throw new Error('Could not check campus availability');
    return { data: [...reps] };
  }
  if (path.startsWith('/admin/users/rep-candidates?')) {
    if (searchFails) throw new Error('Candidate search is unavailable');
    return { data: [...candidates] };
  }
  if (options.method === 'POST') {
    if (mutationFails) throw new Error('This campus already has a representative');
    const id = path.split('/').at(-2);
    const { isCampusRep } = JSON.parse(options.body);
    candidates = candidates.map((user) => user.id === id ? { ...user, isCampusRep } : user);
    if (isCampusRep) reps = [...reps, { ...candidates.find((user) => user.id === id), email: 'assigned@example.invalid' }];
    else reps = reps.filter((user) => user.id !== id);
    return { success: true };
  }
  throw new Error(`Unexpected path: ${path}`);
};
const tick = async (ms = 25) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
const click = async (node) => { assert.ok(node); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await tick(); };
const byText = (scope, text) => Array.from(scope.querySelectorAll('button')).find((node) => node.textContent.trim() === text);
const byLabel = (scope, label) => Array.from(scope.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === label);
const writes = () => calls.filter((call) => call.method === 'POST');
async function render() {
  host = document.createElement('div'); host.className = 'admin-content-surface'; document.body.append(host);
  root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  await act(async () => root.render(element(QueryClientProvider, { client }, element(ConfirmProvider, null, element(CampusRepsPage)))));
  await tick();
}
async function search(value) {
  const input = host.querySelector('input[type="search"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await tick(340); await tick();
}
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{
      name: 'campus-reps-fixture', enforce: 'pre',
      resolveId(source) { if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0reps-api'; },
      load(id) { if (id === '\0reps-api') return 'export const apiRequest = (...args) => globalThis.__campusRepsApi(...args); export const getMediaUrl = () => null;'; },
    }] });
  ({ CampusRepsPage } = await server.ssrLoadModule('/src/pages/CampusRepsPage.tsx'));
  ({ ConfirmProvider } = await server.ssrLoadModule('/src/components/ConfirmProvider.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); reset(); });
after(async () => { await server?.close(); dom.window.close(); delete globalThis.__campusRepsApi; });

test('roster groups by campus ID and the filter keeps summary totals global', async () => {
  await render(); await click(host.querySelector('#rep-tab-current'));
  assert.equal(host.querySelectorAll('.rep-campus-card').length, 2);
  assert.deepEqual(Array.from(host.querySelectorAll('.reps-summary dd'), (node) => node.textContent), ['2', '2']);
  const select = host.querySelector('select');
  await act(async () => { select.value = 'campus2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(host.querySelectorAll('.rep-campus-card').length, 1);
  assert.match(host.querySelector('.rep-campus-card').textContent, /Second Rep/);
  assert.equal(host.querySelector('.reps-summary dd').textContent, '2');
});

test('candidate search is debounced, encodes input and blocks occupied or missing campuses', async () => {
  await render(); assert.equal(calls.some(({ path }) => path.includes('rep-candidates')), false);
  await search('name@example.invalid');
  assert.ok(calls.some(({ path }) => path.endsWith('search=name%40example.invalid')));
  assert.equal(byLabel(host, 'Assign role to @available').disabled, false);
  assert.equal(byLabel(host, 'Assign role to @occupied').disabled, true);
  assert.equal(byLabel(host, 'Assign role to @no-campus').disabled, true);
  assert.match(host.querySelector('.rep-candidates-table').textContent, /Represented by @first/);
  assert.ok(byLabel(host.querySelector('.rep-candidates-table'), 'Revoke role from @second'));
});

test('assignment waits for confirmation and then refreshes the roster', async () => {
  await render(); await search('student');
  await click(byLabel(host, 'Assign role to @available'));
  const confirmation = document.querySelector('[role="alertdialog"]'); assert.ok(confirmation);
  assert.match(confirmation.textContent, /must be revoked/); assert.doesNotMatch(confirmation.textContent, /is replaced/);
  assert.equal(writes().length, 0);
  await click(byText(confirmation, 'Assign role')); await tick();
  assert.deepEqual(writes().map(({ path, body }) => [path, JSON.parse(body)]), [['/admin/users/candidate1/campus-rep', { isCampusRep: true }]]);
  await click(host.querySelector('#rep-tab-current'));
  assert.equal(host.querySelectorAll('.rep-campus-card').length, 3);
});

test('revocation can be cancelled and writes only after explicit confirmation', async () => {
  await render(); await click(host.querySelector('#rep-tab-current')); const revoke = byLabel(host, 'Revoke role from @first');
  await click(revoke);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(writes().length, 0);
  await click(revoke); await click(byText(document.querySelector('[role="alertdialog"]'), 'Revoke role')); await tick();
  assert.deepEqual(writes().map(({ path, body }) => [path, JSON.parse(body)]), [['/admin/users/rep1/campus-rep', { isCampusRep: false }]]);
  assert.equal(host.querySelectorAll('.rep-campus-card').length, 1);
});

test('roster failures show retry, unknown counts and disable assignments', async () => {
  rosterFails = true; await render(); await search('student');
  assert.deepEqual(Array.from(host.querySelectorAll('.reps-summary dd'), (node) => node.textContent), ['—', '—']);
  assert.equal(byLabel(host, 'Assign role to @available').disabled, true);
  assert.equal(host.querySelector('.rep-roster-empty'), null);
  rosterFails = false; await click(byText(host, 'Try again')); await tick();
  assert.equal(host.querySelector('.rep-error'), null);
  assert.equal(byLabel(host, 'Assign role to @available').disabled, false);
});

test('search errors recover, and clearing search hides stale candidates immediately', async () => {
  searchFails = true; await render(); await search('student');
  assert.match(host.querySelector('.rep-error').textContent, /search is unavailable/);
  searchFails = false; await click(byText(host, 'Try again'));
  assert.equal(host.querySelectorAll('.rep-candidates-table tbody tr').length, 4);
  await click(byLabel(host, 'Clear candidate search'));
  assert.equal(host.querySelector('.rep-candidates-table'), null);
  assert.ok(host.querySelector('.rep-search-hint'));
  assert.equal(document.activeElement, host.querySelector('input[type="search"]'));
});

test('server conflicts stay visible in the confirmation and never report a successful assignment', async () => {
  mutationFails = true; await render(); await search('student');
  await click(byLabel(host, 'Assign role to @available'));
  await click(byText(document.querySelector('[role="alertdialog"]'), 'Assign role'));
  const confirmation = document.querySelector('[role="alertdialog"]'); assert.ok(confirmation);
  assert.match(confirmation.textContent, /already has a representative/);
  assert.equal(host.querySelector('.reps-summary dd').textContent, '2');
});

test('pending roster requests render the polished loading state', async () => {
  let release;
  rosterGate = new Promise((resolve) => { release = resolve; });
  await render(); await click(host.querySelector('#rep-tab-current'));
  assert.match(host.querySelector('.admin-loading-state[role="status"]').textContent, /Loading representatives/);
  assert.ok(host.querySelector('.admin-loading-state [aria-hidden="true"]'));
  await act(async () => release()); await tick();
  assert.equal(host.querySelector('.admin-loading-state'), null);
  assert.equal(host.querySelectorAll('.rep-campus-card').length, 2);
});


test('tabs show one view and preserve candidate search and campus filtering across switches', async () => {
  await render();
  assert.equal(host.querySelectorAll('[role="tabpanel"]').length, 1);
  assert.equal(host.querySelector('[role="tabpanel"]').id, 'rep-panel-assign');
  await search('remember me');
  await click(host.querySelector('#rep-tab-current'));
  assert.equal(host.querySelectorAll('[role="tabpanel"]').length, 1);
  assert.equal(host.querySelector('input[type="search"]'), null);
  const select = host.querySelector('select');
  await act(async () => { select.value = 'campus2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(host.querySelector('#rep-tab-assign'));
  assert.equal(host.querySelector('input[type="search"]').value, 'remember me');
  assert.equal(host.querySelectorAll('.rep-candidates-table tbody tr').length, 4);
  await click(host.querySelector('#rep-tab-current'));
  assert.equal(host.querySelector('select').value, 'campus2');
  assert.equal(host.querySelectorAll('.rep-campus-card').length, 1);
  assert.equal(writes().length, 0);
});

test('tab keyboard navigation updates selection, focus and the active panel', async () => {
  await render(); const assign = host.querySelector('#rep-tab-assign'); assign.focus();
  await act(async () => assign.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  const current = host.querySelector('#rep-tab-current');
  assert.equal(document.activeElement, current);
  assert.equal(current.getAttribute('aria-selected'), 'true');
  assert.equal(assign.tabIndex, -1);
  assert.equal(host.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby'), current.id);
  await act(async () => current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  assert.equal(document.activeElement, assign);
  assert.equal(assign.getAttribute('aria-selected'), 'true');
  assert.equal(host.querySelector('[role="tabpanel"]').id, 'rep-panel-assign');
});
