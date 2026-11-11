// Run: node --test admin-frontend/tests/users-page.test.mjs
import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const { JSDOM } = createRequire(new URL('../../frontend/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/users' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLOptGroupElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const element = React.createElement;
let server, UsersPage, ConfirmProvider, root, host, client;
let requests = [], failList = false, shrinkSecondPage = false;
const users = ['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_DELETION', 'DELETED'].map((accountStatus, index) => ({
  id: `u${index}`, username: `student${index}`, displayName: `Student ${index}`, email: `student${index}@example.invalid`,
  accountStatus, verificationStatus: 'VERIFIED', createdAt: '2026-10-01T00:00:00Z', college: { id: 'college1', name: 'Test University' },
}));
let purged = false;
globalThis.__usersPageApi = async (path, options = {}) => {
  requests.push({ path, method: options.method || 'GET', body: options.body });
  if (path.startsWith('/admin/users?')) {
    if (failList) throw new Error('Users are temporarily unavailable');
    if (shrinkSecondPage && path.endsWith('page=2')) return { data: [], meta: { total: 5, totalPages: 1 } };
    return { data: users, meta: { total: 206, totalPages: 11, counts: { active: 100, verified: 90, suspendedOrBanned: 8 } } };
  }
  const match = path.match(/^\/admin\/users\/(u\d)$/);
  if (match) return { ...users.find((user) => user.id === match[1]), collegeAffiliation: {
    collegeName: 'Test University', email: 'student@college.invalid', method: 'CAMPUS_OTP', verifiedAt: '2026-10-01T00:00:00Z',
  }, purgeCompletedAt: purged ? '2026-11-01T00:00:00Z' : null };
  return { success: true };
};
const tick = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); }); };
const click = async (node) => { assert.ok(node); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await tick(); };
const button = (scope, text) => Array.from(scope.querySelectorAll('button')).find((node) => node.textContent.trim() === text);
async function render() {
  host = document.createElement('div'); host.className = 'admin-content-surface'; document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  await act(async () => root.render(element(QueryClientProvider, { client }, element(ConfirmProvider, null, element(UsersPage)))));
  await tick();
}
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{
      name: 'user-page-api-fixture', enforce: 'pre',
      resolveId(source) { if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0users-api'; },
      load(id) { if (id === '\0users-api') return 'export const apiRequest = (...args) => globalThis.__usersPageApi(...args); export const getMediaUrl = () => null;'; },
    }] });
  ({ UsersPage } = await server.ssrLoadModule('/src/pages/UsersPage.tsx'));
  ({ ConfirmProvider } = await server.ssrLoadModule('/src/components/ConfirmProvider.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); requests = []; purged = false; failList = false; shrinkSecondPage = false; });
after(async () => { await server?.close(); dom.window.close(); delete globalThis.__usersPageApi; });

test('summaries use server totals and account controls match supported lifecycle states', async () => {
  await render();
  assert.deepEqual(Array.from(host.querySelectorAll('.users-summary dd'), (node) => node.textContent), ['206', '100', '90', '8']);
  const rows = host.querySelectorAll('tbody tr');
  assert.ok(button(rows[0], 'Suspend')); assert.equal(button(rows[0], 'Unsuspend'), undefined);
  assert.ok(button(rows[1], 'Unsuspend'));
  for (const row of [rows[2], rows[3], rows[4]]) assert.equal(button(row, 'Unsuspend'), undefined);
  assert.ok(button(rows[0], 'Reset College'));
  assert.equal(button(rows[3], 'Delete'), undefined); assert.equal(button(rows[4], 'Delete'), undefined);
  assert.equal(requests.filter((request) => request.method !== 'GET').length, 0);
});

test('pagination and filtering request the selected page and reset to page one', async () => {
  await render(); await click(button(host, 'Next'));
  assert.ok(requests.some(({ path }) => path.endsWith('page=2')));
  await click(button(host.querySelector('.users-status-options'), 'Suspended'));
  assert.ok(requests.at(-1).path.includes('accountStatus=SUSPENDED&page=1'));
});

test('details lock scrolling, trap keyboard focus and restore the opener on Escape', async () => {
  await render(); const opener = button(host, 'Details'); opener.focus(); host.scrollTop = 190;
  await click(opener);
  const dialog = document.querySelector('[role="dialog"]'); assert.ok(dialog);
  assert.equal(host.style.overflow, 'hidden'); assert.equal(host.scrollTop, 190);
  assert.equal(document.activeElement, dialog.querySelector('.dialog-close'));
  const last = Array.from(dialog.querySelectorAll('button')).at(-1); last.focus();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
  assert.equal(document.activeElement, dialog.querySelector('.dialog-close'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, opener); assert.equal(host.style.overflow, '');
});

test('suspending and resetting college require explicit confirmation', async () => {
  await render(); const row = host.querySelector('tbody tr');
  await click(button(row, 'Suspend'));
  assert.equal(requests.some(({ method }) => method !== 'GET'), false);
  await click(button(document.querySelector('[role="alertdialog"]'), 'Suspend'));
  assert.ok(requests.some(({ path, method }) => path === '/admin/users/u0/suspend' && method === 'POST'));
  await click(button(row, 'Reset College'));
  const dialog = document.querySelector('[role="alertdialog"]'); assert.ok(dialog);
  assert.equal(requests.some(({ path }) => path.endsWith('reset-college')), false);
  await click(button(dialog, 'Reset college'));
  assert.ok(requests.some(({ path, method }) => path.endsWith('reset-college') && method === 'POST'));
});

test('restoration uses detail metadata, confirms before writing and excludes purged accounts', async () => {
  await render(); await click(button(host.querySelectorAll('tbody tr')[3], 'Details'));
  const dialog = document.querySelector('[role="dialog"]');
  await click(button(dialog, 'Restore account'));
  assert.equal(requests.some(({ path }) => path.endsWith('/restore')), false);
  await click(button(document.querySelector('[role="alertdialog"]'), 'Restore account'));
  assert.ok(requests.some(({ path, method }) => path === '/admin/users/u3/restore' && method === 'POST'));
  await click(dialog.querySelector('.dialog-close'));
  purged = true;
  await click(button(host.querySelectorAll('tbody tr')[4], 'Details'));
  const purgedDialog = document.querySelector('[role="dialog"]');
  assert.equal(button(purgedDialog, 'Restore account'), undefined);
  assert.match(purgedDialog.textContent, /cannot be restored/);
});

test('list failures show an error and retry rather than successful zero totals', async () => {
  failList = true; await render();
  assert.match(host.querySelector('[role="alert"]').textContent, /temporarily unavailable/);
  assert.deepEqual(Array.from(host.querySelectorAll('.users-summary dd'), (node) => node.textContent), ['—', '—', '—', '—']);
  failList = false; await click(button(host, 'Try again'));
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(host.querySelectorAll('tbody tr').length, 5);
});


test('a shrinking result set returns to a valid page instead of stranding the directory', async () => {
  await render(); shrinkSecondPage = true;
  await click(button(host, 'Next')); await tick();
  assert.ok(requests.some(({ path }) => path.endsWith('page=2')));
  assert.match(host.textContent, /Page 1 of 11/);
  assert.equal(host.querySelectorAll('tbody tr').length, 5);
});

test('affiliation revocation requires a nonblank reason and a second confirmation', async () => {
  await render(); await click(button(host, 'Details'));
  const dialog = document.querySelector('[role="dialog"]');
  await click(button(dialog, 'Revoke affiliation'));
  const reason = dialog.querySelector('textarea');
  assert.equal(button(dialog, 'Continue').disabled, true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(reason, 'Email belongs to someone else');
    reason.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(button(dialog, 'Continue').disabled, false);
  await click(button(dialog, 'Continue'));
  assert.equal(requests.some(({ method }) => method !== 'GET'), false);
  const confirmation = document.querySelector('[role="alertdialog"]'); assert.ok(confirmation);
  await click(button(confirmation, 'Revoke affiliation'));
  assert.ok(requests.some(({ path, method, body }) => path.endsWith('college-affiliation/revoke') && method === 'PATCH' && JSON.parse(body).reason === 'Email belongs to someone else'));
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.equal(host.style.overflow, 'hidden');
});
