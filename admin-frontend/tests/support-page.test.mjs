// Run: node admin-frontend/tests/support-page.test.mjs
import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
const { JSDOM } = createRequire(new URL('../../frontend/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/support' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLOptGroupElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const el = React.createElement;
let server, SupportPage, ConfirmProvider, root, host, client;
let calls, detailGate, detailFails, saveFails, replyFails, deleteFails, statsFail;
const ticket = { id: 'ticket-one', ticketNumber: 'SUP-001', subject: 'Account help', email: 'example@campus.test', name: 'Example', status: 'OPEN', priority: 'NORMAL', category: 'ACCOUNT_LOGIN', type: 'PROBLEM', createdAt: '2026-11-08T10:00:00Z', updatedAt: '2026-11-08T10:00:00Z', emailStatus: 'SENT',
  attachments: [{ key: 'private-key', filename: 'proof.png', size: 2048, url: 'https://private.example.test/signed' }, { key: 'expired', filename: 'expired.png', size: 1024 }],
  messages: [{ id: 'user-message', authorType: 'USER', body: '<img src=x onerror=alert(1)>', createdAt: '2026-11-08T10:00:00Z' }, { id: 'note', authorType: 'ADMIN', isInternal: true, body: '<b>Private team note</b>', createdAt: '2026-11-08T10:01:00Z' }, { id: 'reply', authorType: 'ADMIN', body: '<p>Safe <strong>reply</strong></p>', emailStatus: 'SENT', createdAt: '2026-11-08T10:02:00Z' }] };
const category = { id: 'category-one', title: 'Account', slug: 'account', status: 'DRAFT', articleCount: 1, publishedArticleCount: 0 };
function reset() { calls = []; detailGate = null; detailFails = saveFails = replyFails = deleteFails = statsFail = false; }
reset();
globalThis.__supportApi = async (path, options = {}) => {
  const method = options.method || 'GET'; calls.push({ path, method, body: options.body && JSON.parse(options.body) });
  if (method !== 'GET') {
    if (path.endsWith('/reply-preview')) return { html: '<p>Sanitized preview</p>', wasModified: true };
    if (path.endsWith('/reply')) { if (replyFails) throw new Error('Reply unavailable'); return { emailQueued: true }; }
    if (method === 'DELETE') { if (deleteFails) throw new Error('Delete unavailable'); return {}; }
    if (path.includes('/help/')) { if (saveFails) throw new Error('Save unavailable'); return {}; }
    return {};
  }
  if (path === '/admin/support/stats') { if (statsFail) throw new Error('Stats unavailable'); return { byStatus: { OPEN: 8, IN_PROGRESS: 3, WAITING_FOR_USER: 2, RESOLVED: 12 }, unassigned: 5, failedEmails: 1 }; }
  if (path === '/admin/support/assignees') return [{ id: 'admin-one', name: 'Admin One' }];
  if (path.startsWith('/admin/support/help/categories')) return [category];
  if (path.startsWith('/admin/support/help/articles')) return [{ id: 'article-one', categoryId: category.id, question: 'How do I sign in?', slug: 'sign-in', body: '<p>Instructions</p>', status: 'DRAFT', category, updatedAt: ticket.updatedAt }];
  if (path.startsWith('/admin/support?')) { const page = Number(new URL(path, 'http://localhost').searchParams.get('page')); return { data: [ticket, { ...ticket, id: 'ticket-two', ticketNumber: 'SUP-002', subject: 'Second ticket' }], meta: { page, total: 22, totalPages: 2 } }; }
  if (path === '/admin/support/ticket-one' || path === '/admin/support/ticket-two') { if (detailGate) await detailGate; if (detailFails) throw new Error('Ticket unavailable'); return { ...ticket, id: path.split('/').at(-1) }; }
  throw new Error(`Unexpected path: ${path}`);
};
const tick = async (ms = 35) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const click = async (node) => { assert.ok(node, 'Expected a control'); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await tick(); };
const button = (scope, text) => Array.from(scope.querySelectorAll('button')).find((node) => node.textContent.trim() === text);
const writes = () => calls.filter(({ method }) => method !== 'GET');
async function input(node, value, wait = 0) { await act(async () => { const proto = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }); if (wait) await tick(wait); }
async function select(node, value) { await act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }); await tick(); }
function Location() { const location = useLocation(); return el('output', { id: 'location' }, location.search); }
async function render(route = '/support') {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  await act(async () => root.render(el(QueryClientProvider, { client }, el(ConfirmProvider, null, el(MemoryRouter, { initialEntries: [route] }, el(React.Fragment, null, el(SupportPage), el(Location))))))); await tick();
}
const help = async () => click(button(host.querySelector('.support-section-tabs'), 'Help content'));
const open = async () => click(host.querySelector('.support-ticket'));
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{ name: 'support-fixture', enforce: 'pre', resolveId(source) { if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0support-api'; }, load(id) { if (id === '\0support-api') return 'export const apiRequest = (...args) => globalThis.__supportApi(...args); export const getMediaUrl = () => null;'; } }] });
  ({ SupportPage } = await server.ssrLoadModule('/src/pages/SupportPage.tsx'));
  ({ ConfirmProvider } = await server.ssrLoadModule('/src/components/ConfirmProvider.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); reset(); });
after(async () => { await server?.close(); dom.window.close(); delete globalThis.__supportApi; });

test('summaries use global server totals and scope labels match their actual filter', async () => {
  await render(); assert.deepEqual(Array.from(host.querySelectorAll('.support-summary dd'), (node) => node.textContent), ['8', '3', '2', '12']);
  await click(button(host.querySelector('.support-queue-scopes'), 'In progress'));
  assert.ok(calls.some(({ path }) => path.includes('status=IN_PROGRESS')));
  assert.match(host.querySelector('.support-result-count').textContent, /22 matching requests/); assert.equal(writes().length, 0);
});
test('deep links open a ticket, switching sections clears only its query parameter, and appeals remain category locked', async () => {
  await render('/support?ticket=ticket-one&keep=yes'); assert.match(host.querySelector('.support-detail-subject').textContent, /Account help/);
  await help(); assert.match(host.textContent, /Help categories/); assert.equal(host.querySelector('#location').textContent, '?keep=yes');
  await click(button(host.querySelector('.support-section-tabs'), 'Suspension appeals'));
  assert.ok(calls.some(({ path }) => path.includes('category=SUSPENSION_APPEAL')));
  await click(host.querySelector('[aria-label="Filters"]')); assert.equal(host.querySelector('select[aria-label="Category"]'), null);
});
test('server pagination, debounced search and filters retain enum contracts and reset the page', async () => {
  await render(); await click(button(host, 'Next')); assert.ok(calls.some(({ path }) => path.includes('page=2')));
  await input(host.querySelector('input[aria-label="Search tickets"]'), 'campus', 350);
  assert.ok(calls.some(({ path }) => path.includes('search=campus') && path.includes('page=1')));
  await click(host.querySelector('[aria-label="Filters"]')); await select(host.querySelector('select[aria-label="Priority"]'), 'URGENT');
  assert.ok(calls.some(({ path }) => path.includes('priority=URGENT')));
});
test('loading and failed ticket views allow returning to the queue, and errors can be retried', async () => {
  let release; detailGate = new Promise((resolve) => { release = resolve; }); await render('/support?ticket=ticket-one');
  assert.match(host.querySelector('.admin-loading-state').textContent, /Loading ticket/); await click(button(host, 'Back to tickets'));
  assert.equal(host.querySelector('.support-workspace').dataset.selected, 'false');
  detailFails = true; release(); await tick(); await open(); assert.match(host.querySelector('.support-detail-panel').textContent, /Ticket unavailable/);
  detailFails = false; await click(button(host.querySelector('.support-detail-panel'), 'Try again')); assert.ok(host.querySelector('.support-detail-subject'));
});
test('user messages and private notes remain plain text; attachments never get a public URL fallback', async () => {
  await render('/support?ticket=ticket-one');
  const messages = host.querySelector('.support-conversation'); assert.equal(messages.querySelector('img'), null); assert.equal(messages.querySelector('.is-note b'), null); assert.ok(messages.querySelector('.is-admin strong'));
  await click(button(host, 'Details')); const links = host.querySelectorAll('.support-attachment');
  assert.equal(links[0].getAttribute('href'), 'https://private.example.test/signed'); assert.equal(links[1].getAttribute('href'), null);
});
test('reply preview is sanitized, sending requires confirmation, and a failed send preserves the draft and private note', async () => {
  await render('/support?ticket=ticket-one'); await click(button(host, 'Write a reply to the user'));
  const editor = host.querySelector('[contenteditable]'); await act(async () => { editor.innerHTML = '<p>My draft</p>'; editor.dispatchEvent(new Event('input', { bubbles: true })); }); await tick();
  await click(button(host, 'Add an internal note')); await input(host.querySelector('#internal-note'), 'Team only');
  await click(button(host, 'Preview')); assert.match(host.querySelector('.support-preview').textContent, /Sanitized preview/);
  await click(button(host, 'Send reply')); assert.equal(writes().filter(({ path }) => path.endsWith('/reply')).length, 0);
  replyFails = true; await click(button(host, 'Confirm and send')); assert.match(editor.textContent, /My draft/); assert.equal(host.querySelector('#internal-note').value, 'Team only');
  const sent = writes().find(({ path }) => path.endsWith('/reply')); assert.deepEqual(sent.body, { body: '<p>My draft</p>', status: 'OPEN', internalNote: 'Team only' });
  assert.match(host.textContent, /Reply unavailable/);
});
test('failed help category saves keep the editor and draft open with an inline error', async () => {
  await render(); await help(); await click(button(host, 'New category'));
  const dialog = host.querySelector('[role="dialog"]'); await input(dialog.querySelector('input'), 'Draft category'); saveFails = true; await click(button(dialog, 'Save'));
  assert.ok(host.querySelector('[role="dialog"]')); assert.equal(dialog.querySelector('input').value, 'Draft category'); assert.match(dialog.querySelector('[role="alert"]').textContent, /Save unavailable/);
  saveFails = false; await click(button(dialog, 'Save')); assert.equal(host.querySelector('[role="dialog"]'), null);
});
test('help deletes require confirmation and keep that confirmation open after failure', async () => {
  await render(); await help(); await click(host.querySelector('[aria-label="Delete Account"]')); assert.equal(writes().length, 0);
  deleteFails = true; await click(button(document.querySelector('[role="alertdialog"]'), 'Delete permanently'));
  assert.ok(document.querySelector('[role="alertdialog"]')); assert.match(document.querySelector('[role="alertdialog"]').textContent, /Delete unavailable/);
});

test('section tabs support keyboard navigation and help editors trap focus and close with Escape', async () => {
  await render();
  const tabs = host.querySelector('.support-section-tabs');
  await act(async () => tabs.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))); await tick();
  assert.equal(tabs.querySelector('[aria-selected="true"]').textContent.trim(), 'Help content');
  assert.ok(document.activeElement === tabs.querySelector('[aria-selected="true"]'), 'Keyboard selection should focus the active tab');
  const opener = button(host, 'New category'); opener.focus();
  await click(opener); const dialog = host.querySelector('[role="dialog"]');
  const first = dialog.querySelector('button'); first.focus();
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  assert.ok(dialog.contains(document.activeElement) && document.activeElement !== first, 'Focus should wrap within the editor');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await tick();
  assert.equal(host.querySelector('[role="dialog"]'), null);
  assert.ok(document.activeElement === opener, 'Closing the editor should restore focus');
});

test('a failed help article save preserves the answer and displays its error in the editor', async () => {
  await render(); await help(); await click(button(host, 'New article'));
  const dialog = host.querySelector('[role="dialog"]');
  await input(dialog.querySelector('input'), 'A new question'); await input(dialog.querySelector('textarea'), '<p>Draft answer</p>');
  saveFails = true; await click(button(dialog, 'Save'));
  assert.equal(dialog.querySelector('textarea').value, '<p>Draft answer</p>'); assert.match(dialog.querySelector('[role="alert"]').textContent, /Save unavailable/);
});
