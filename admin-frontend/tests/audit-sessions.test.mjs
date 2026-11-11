// Run: node admin-frontend/tests/audit-sessions.test.mjs
import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const { JSDOM } = createRequire(new URL('../../frontend/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/audit' });
for (const name of ['window', 'document', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const el = React.createElement;
let server, AuditPage, SessionsPage, ConfirmProvider, root, host, client;
let calls, failList, failWrite, gate, writeGate, logoutCalls, sessions, entries, total;
const date = '2026-11-08T10:00:00Z';
function reset() {
  calls = []; failList = failWrite = false; gate = writeGate = null; logoutCalls = 0; total = 41;
  sessions = [{ id: 'session-one', deviceName: 'Example laptop', browser: 'Chrome 130', os: 'Example OS', ip: '2001:db8::1234', createdAt: date, lastActiveAt: date }, { id: 'session-two', deviceName: 'Example phone', browser: 'Mobile browser', os: null, ip: null, createdAt: date, lastActiveAt: date }];
  entries = { logs: [{ id: 'log-1', action: 'VERIFICATION_APPROVE', adminId: 'admin-one', admin: { name: 'Example Admin' }, targetType: 'VERIFICATION', targetId: 'target-example', ip: '2001:db8::1234', createdAt: date }, { id: 'log-2', action: 'SESSION_REVOKE', admin: null, targetType: null, targetId: null, ip: null, createdAt: date }], 'security-events': [{ id: 'security-1', type: 'TOKEN_REUSE_DETECTED', ip: null, metadata: { note: '<img src=x onerror=alert(1)>', nested: { reason: 'fixture' } }, createdAt: date }], 'login-audits': [{ id: 'login-1', email: 'admin@example.test', success: false, failureReason: 'Please check your one-time code.', browser: null, os: null, ip: null, createdAt: date }, { id: 'login-2', email: 'second@example.test', success: true, browser: 'Example browser', os: 'Example OS', createdAt: date }] };
}
reset();
globalThis.__activityAuth = { logout: async () => { logoutCalls++; } };
globalThis.__activityApi = async (path, options = {}) => {
  const method = options.method || 'GET'; calls.push({ path, method });
  if (method === 'POST') {
    if (writeGate) await writeGate; if (failWrite) throw new Error('Revocation unavailable');
    if (path === '/admin/auth/logout-all') return { success: true };
    const id = decodeURIComponent(path.split('/').at(-2)); sessions = sessions.filter((session) => session.id !== id); return { success: true };
  }
  if (gate) await gate; if (failList) throw new Error('Activity unavailable');
  if (path === '/admin/auth/sessions') return [...sessions];
  const url = new URL(path, 'http://localhost'); const key = url.pathname.split('/').at(-1);
  if (key in entries) return { data: structuredClone(entries[key]), meta: { total, page: Number(url.searchParams.get('page') || 1), totalPages: Math.ceil(total / 20) } };
  throw new Error(`Unexpected request: ${path}`);
};
const tick = async (ms = 40) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const click = async (node) => { assert.ok(node, 'Expected a control'); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await tick(); };
const button = (scope, text) => Array.from(scope.querySelectorAll('button')).find((node) => node.textContent.trim() === text);
const confirmation = () => document.querySelector('[role="alertdialog"]');
const writes = () => calls.filter(({ method }) => method !== 'GET');
async function render(Page) {
  host = document.createElement('div'); host.id = 'root'; host.className = 'admin-content-surface'; document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  await act(async () => root.render(el(QueryClientProvider, { client }, el(ConfirmProvider, null, el(Page))))); await tick();
}
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{ name: 'activity-fixture', enforce: 'pre', resolveId(source) { if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0activity-api'; if (/\/context\/AuthContext(?:\.tsx)?$/.test(source)) return '\0activity-auth'; }, load(id) { if (id === '\0activity-api') return 'export const apiRequest = (...args) => globalThis.__activityApi(...args);'; if (id === '\0activity-auth') return 'export const useAuth = () => globalThis.__activityAuth;'; } }] });
  ({ AuditPage } = await server.ssrLoadModule('/src/pages/AuditPage.tsx'));
  ({ SessionsPage } = await server.ssrLoadModule('/src/pages/SessionsPage.tsx'));
  ({ ConfirmProvider } = await server.ssrLoadModule('/src/components/ConfirmProvider.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); reset(); });
after(async () => { await server?.close(); dom.window.close(); delete globalThis.__activityApi; delete globalThis.__activityAuth; });

test('audit summary uses server totals and labels are readable without null targets', async () => {
  await render(AuditPage); assert.equal(host.querySelector('.activity-overview-count strong').textContent, '41');
  assert.match(host.querySelector('.audit-table').textContent, /Verification approve/); assert.doesNotMatch(host.querySelector('.audit-table').textContent, /null: null|undefined|VERIFICATION_APPROVE/);
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/admin/audit/logs?page=1'); assert.equal(writes().length, 0);
});
test('audit tabs reset pagination before requesting the new category', async () => {
  await render(AuditPage); await click(button(host, 'Next')); assert.equal(calls.at(-1).path, '/admin/audit/logs?page=2');
  await click(button(host, 'Security events')); assert.equal(calls.at(-1).path, '/admin/audit/security-events?page=1'); assert.equal(calls.some(({ path }) => path === '/admin/audit/security-events?page=2'), false);
  await click(button(host, 'Sign-in history')); assert.equal(calls.at(-1).path, '/admin/audit/login-audits?page=1');
});
test('security metadata expands as escaped text and long payloads remain in their disclosure', async () => {
  await render(AuditPage); await click(button(host, 'Security events')); const disclosure = host.querySelector('.audit-event-details');
  assert.equal(disclosure.open, false); await click(disclosure.querySelector('summary')); assert.equal(disclosure.open, true);
  assert.equal(disclosure.querySelector('img'), null); assert.match(disclosure.querySelector('pre').textContent, /<img src=x onerror=alert\(1\)>/); assert.match(host.querySelector('.audit-table').textContent, /Not recorded/);
});
test('sign-in outcomes preserve human failure reasons and missing device details are explicit', async () => {
  await render(AuditPage); await click(button(host, 'Sign-in history')); const table = host.querySelector('.audit-table');
  assert.match(table.textContent, /Failed/); assert.match(table.textContent, /Successful/); assert.match(table.textContent, /Please check your one-time code\./); assert.match(table.textContent, /Unknown browser/); assert.doesNotMatch(table.textContent, /undefined on undefined/);
});
test('audit loading and errors use the shared spinner and allow retry', async () => {
  let release; gate = new Promise((resolve) => { release = resolve; }); await render(AuditPage); assert.ok(host.querySelector('.admin-loading-state'));
  failList = true; release(); gate = null; await tick(); assert.match(host.querySelector('[role="alert"]').textContent, /Activity unavailable/); assert.doesNotMatch(host.textContent, /No entries recorded/);
  failList = false; await click(button(host, 'Try again')); assert.ok(host.querySelector('.audit-table'));
});
test('empty audit views show a compact empty state and refresh only their selected endpoint', async () => {
  entries['security-events'] = []; total = 0; await render(AuditPage); await click(button(host, 'Security events')); assert.match(host.querySelector('.activity-state').textContent, /No entries recorded/);
  await click(host.querySelector('[aria-label="Refresh audit logs"]')); assert.equal(calls.at(-1).path, '/admin/audit/security-events?page=1');
});
test('session cards show the account-scoped list with safe fallbacks and no inferred current-device marker', async () => {
  await render(SessionsPage); assert.equal(host.querySelector('.activity-overview-count strong').textContent, '2'); assert.equal(host.querySelectorAll('.session-card').length, 2);
  assert.match(host.textContent, /your admin account/); assert.match(host.textContent, /Not recorded/); assert.match(host.textContent, /Unknown operating system/); assert.match(host.textContent, /2001:db8::1234/);
  assert.equal(host.querySelector('.session-current'), null); assert.equal(calls[0].path, '/admin/auth/sessions'); assert.equal(writes().length, 0);
});
test('session load failures are distinct from an empty list and retry successfully', async () => {
  failList = true; await render(SessionsPage); assert.match(host.querySelector('[role="alert"]').textContent, /Activity unavailable/); assert.equal(button(host, 'Revoke all sessions').disabled, true);
  failList = false; await click(button(host, 'Try again')); assert.equal(host.querySelectorAll('.session-card').length, 2);
});
test('single session revocation requires confirmation, and failed revocation stays visible', async () => {
  await render(SessionsPage); await click(button(host.querySelector('.session-card'), 'Revoke session')); assert.equal(writes().length, 0);
  await click(button(confirmation(), 'Cancel')); assert.equal(writes().length, 0);
  await click(button(host.querySelector('.session-card'), 'Revoke session')); failWrite = true; await click(button(confirmation(), 'Revoke session'));
  assert.ok(confirmation()); assert.match(confirmation().textContent, /Revocation unavailable/); assert.equal(host.querySelectorAll('.session-card').length, 2); assert.equal(logoutCalls, 0);
  failWrite = false; await click(button(confirmation(), 'Revoke session')); assert.equal(confirmation(), null); assert.equal(host.querySelectorAll('.session-card').length, 1); assert.match(host.querySelector('.sessions-notice').textContent, /Session revoked/);
});
test('a revocation in progress disables other session mutations and refresh', async () => {
  await render(SessionsPage); await click(button(host.querySelector('.session-card'), 'Revoke session')); let release; writeGate = new Promise((resolve) => { release = resolve; }); await click(button(confirmation(), 'Revoke session'));
  assert.equal(button(host, 'Revoke all sessions').disabled, true); assert.equal(host.querySelector('[aria-label="Refresh sessions"]').disabled, true); assert.ok(Array.from(host.querySelectorAll('.session-revoke')).every((node) => node.disabled));
  release(); await tick(); assert.equal(confirmation(), null);
});
test('revoke-all explains its scope and only signs out locally after the server succeeds', async () => {
  await render(SessionsPage); await click(button(host, 'Revoke all sessions')); assert.equal(writes().length, 0); assert.match(confirmation().textContent, /Your admin account/); assert.match(confirmation().textContent, /session you are using now/); assert.doesNotMatch(confirmation().textContent, /All super admin|Anyone currently working/);
  failWrite = true; await click(button(confirmation(), 'Revoke all')); assert.ok(confirmation()); assert.equal(logoutCalls, 0);
  failWrite = false; await click(button(confirmation(), 'Revoke all')); assert.equal(logoutCalls, 1); assert.equal(writes().at(-1).path, '/admin/auth/logout-all');
});
test('sessions use the shared loading spinner and an explicit empty state', async () => {
  let release; gate = new Promise((resolve) => { release = resolve; }); await render(SessionsPage); assert.match(host.querySelector('.admin-loading-state').textContent, /Loading sessions/);
  sessions = []; release(); gate = null; await tick(); assert.match(host.querySelector('.activity-state').textContent, /No active sessions found/); assert.equal(button(host, 'Revoke all sessions').disabled, true);
});
