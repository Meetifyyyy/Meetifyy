// Run: node admin-frontend/tests/deletion-legal.test.mjs
import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, Link, Outlet } from 'react-router-dom';
const { JSDOM } = createRequire(new URL('../../frontend/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/legal' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLOptGroupElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node', 'Range']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const el = React.createElement;
let server, AccountDeletionPage, LegalPage, LegalDocumentPage, LegalEditorPage, ConfirmProvider, root, host, client, router;
let calls, rows, failList, failDetail, failWrite, failPreview, gate, docs, detail, version;
const date = '2026-11-08T10:00:00Z';
const row = (id = 'user-1') => ({ userId: id, username: 'example', email: 'student@campus.test', college: 'Example University', accountStatus: 'PENDING_DELETION', deletionRequestedAt: date, scheduledPurgeAt: '2026-12-08T10:00:00Z', purgeCompletedAt: null, purgeAttempts: 0, purgeLastError: null, daysRemaining: 28, dueNow: false, purgeInProgress: false, status: 'pending', canRestore: true, canPurgeNow: false });
function reset() {
  calls = []; rows = [row()]; failList = failDetail = failWrite = failPreview = false; gate = null;
  version = { id: 'version-2', documentType: 'TERMS_OF_SERVICE', versionNumber: 2, title: 'Terms of Service', subtitle: 'Terms subtitle', content: '<p>Saved legal content</p>', status: 'PUBLISHED', isCurrent: true, requiresAcknowledgement: true, changeSummary: 'Clearer account rules', effectiveAt: date, createdAt: date, updatedAt: date, publishedAt: date, restoredFromVersionId: null, createdBy: null, publishedBy: null };
  const draft = { ...version, id: 'draft-3', versionNumber: 3, status: 'DRAFT', isCurrent: false, requiresAcknowledgement: false };
  detail = { documentType: version.documentType, label: 'Terms of Service', path: '/terms', published: { ...version }, draft, history: [{ ...version, notified: true, stats: { acknowledged: 4, totalActiveUsers: 10 } }, { ...version, id: 'version-1', versionNumber: 1, isCurrent: false, notified: false }], totalActiveUsers: 10 };
  docs = [{ ...detail, publishedVersionCount: 2, lastNotifiedAt: date, stats: { acknowledged: 4, totalActiveUsers: 10 } }, { documentType: 'PRIVACY_POLICY', label: 'Privacy Policy', path: '/privacy', published: null, draft: null, publishedVersionCount: 0, lastNotifiedAt: null, stats: null }];
}
reset();
globalThis.__deletionLegalApi = async (path, options = {}) => {
  const method = options.method || 'GET'; const body = options.body && JSON.parse(options.body); calls.push({ path, method, body });
  if (path === '/admin/legal/preview') { if (failPreview) throw new Error('Preview unavailable'); return { html: '<p>Sanitized preview</p>', wasModified: true, plainText: 'Sanitized preview' }; }
  if (method !== 'GET') {
    if (gate) await gate; if (failWrite) throw new Error('Change unavailable');
    if (path.startsWith('/admin/account-deletion/')) { rows = []; return { purged: 1, failed: 0 }; }
    if (path.endsWith('/publish')) return { ...version, versionNumber: 3 };
    if (path.endsWith('/notify')) return { versions: [version] };
    if (path.endsWith('/draft') && method === 'PUT') { detail.draft = { ...detail.draft, ...body }; return { ...detail.draft }; }
    if (path.endsWith('/draft') && method === 'POST') { detail.draft ??= { ...version, id: 'new-draft', versionNumber: 3, status: 'DRAFT', isCurrent: false }; return { ...detail.draft }; }
    if (method === 'DELETE') { detail.draft = null; return { success: true }; }
    throw new Error(`Unexpected write ${path}`);
  }
  const url = new URL(path, 'http://localhost');
  if (url.pathname === '/admin/account-deletion') {
    if (gate) await gate; if (failList) throw new Error('Queue unavailable');
    const page = Number(url.searchParams.get('page') || 1); return { requests: rows.slice((page - 1) * 20, page * 20), pagination: { page, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / 20)) }, counts: { pending: 8, dueNow: 2, failed: 1, completed: 5 }, recoveryWindowDays: 30 };
  }
  if (path === '/admin/legal/documents') { if (gate) await gate; if (failList) throw new Error('Documents unavailable'); return structuredClone(docs); }
  if (path === '/admin/legal/audience') return { totalActiveUsers: 10 };
  if (path.startsWith('/admin/legal/versions/')) { if (failDetail) throw new Error('Version unavailable'); return { ...version }; }
  if (path === '/admin/legal/documents/PRIVACY_POLICY') return { ...structuredClone(detail), documentType: 'PRIVACY_POLICY', label: 'Privacy Policy', path: '/privacy', draft: { ...structuredClone(detail.draft), id: 'privacy-draft', documentType: 'PRIVACY_POLICY', title: 'Privacy draft' } };
  if (path === '/admin/legal/documents/TERMS_OF_SERVICE') { if (failDetail) throw new Error('Document unavailable'); return structuredClone(detail); }
  throw new Error(`Unexpected request ${path}`);
};
const tick = async (ms = 40) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const click = async (node) => { assert.ok(node, 'Expected a control'); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await tick(); };
const button = (scope, text) => Array.from(scope.querySelectorAll('button')).find((node) => node.textContent.trim() === text);
const confirmation = () => document.querySelector('[role="alertdialog"]');
const modal = () => document.querySelector('.legal-modal');
const mutations = () => calls.filter(({ method, path }) => method !== 'GET' && path !== '/admin/legal/preview');
async function input(node, value) { await act(async () => { const proto = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }); await tick(); }
async function render(path) {
  host = document.createElement('div'); host.id = 'root'; host.className = 'admin-content-surface'; document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  router = createMemoryRouter([{ element: el(React.Fragment, null, el(Link, { to: '/legal', id: 'test-navigation' }, 'Documents'), el(Outlet)), children: [{ path: '/account-deletion', element: el(AccountDeletionPage) }, { path: '/legal', element: el(LegalPage) }, { path: '/legal/:type', element: el(LegalDocumentPage) }, { path: '/legal/:type/edit', element: el(LegalEditorPage) }] }], { initialEntries: [path] });
  await act(async () => root.render(el(QueryClientProvider, { client }, el(ConfirmProvider, null, el(RouterProvider, { router }))))); await tick();
}
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{ name: 'deletion-legal-fixture', enforce: 'pre', resolveId(source) { if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0deletion-legal-api'; if (/\/components\/Toaster(?:\.tsx)?$/.test(source)) return '\0deletion-legal-toast'; }, load(id) { if (id === '\0deletion-legal-api') return 'export const apiRequest = (...args) => globalThis.__deletionLegalApi(...args);'; if (id === '\0deletion-legal-toast') return 'export const pushToast = () => {};'; } }] });
  ({ AccountDeletionPage } = await server.ssrLoadModule('/src/pages/AccountDeletionPage.tsx'));
  ({ LegalPage } = await server.ssrLoadModule('/src/pages/LegalPage.tsx'));
  ({ LegalDocumentPage } = await server.ssrLoadModule('/src/pages/legal/LegalDocumentPage.tsx'));
  ({ LegalEditorPage } = await server.ssrLoadModule('/src/pages/legal/LegalEditorPage.tsx'));
  ({ ConfirmProvider } = await server.ssrLoadModule('/src/components/ConfirmProvider.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); router?.dispose(); client?.clear(); host?.remove(); reset(); });
after(async () => { await server?.close(); dom.window.close(); delete globalThis.__deletionLegalApi; });

test('deletion summaries use global totals and row actions follow server capabilities', async () => {
  rows.push({ ...row('user-2'), status: 'due', dueNow: true, canRestore: false, canPurgeNow: false }); await render('/account-deletion');
  assert.deepEqual(Array.from(host.querySelectorAll('.deletion-summary dd'), (node) => node.textContent), ['8', '2', '1', '5']);
  assert.match(host.querySelector('.deletion-stat').textContent, /Pending deletion/); const cards = host.querySelectorAll('.deletion-card');
  assert.ok(button(cards[0], 'Restore account')); assert.equal(cards[1].querySelector('.deletion-card-actions'), null); assert.equal(host.querySelector('img'), null); assert.equal(mutations().length, 0);
});
test('deletion pagination, filters and debounced search keep server parameters', async () => {
  rows = Array.from({ length: 21 }, (_, index) => row(`user-${index}`)); await render('/account-deletion'); await click(button(host, 'Next')); assert.ok(calls.at(-1).path.includes('page=2'));
  await click(button(host.querySelector('.deletion-status-filters'), 'Needs attention')); assert.match(calls.at(-1).path, /filter=failed&page=1/);
  await input(host.querySelector('input'), 'student'); await tick(350); assert.ok(calls.at(-1).path.includes('search=student'));
});
test('deletion loading and errors show a spinner and retry rather than an empty queue', async () => {
  let release; gate = new Promise((resolve) => { release = resolve; }); await render('/account-deletion'); assert.ok(host.querySelector('.admin-loading-state'));
  failList = true; release(); gate = null; await tick(); assert.match(host.querySelector('.deletion-empty').textContent, /Queue unavailable/); assert.equal(button(host, 'Run purge sweep').disabled, true);
  failList = false; await click(button(host, 'Try again')); assert.ok(host.querySelector('.deletion-card'));
});
test('restore and permanent deletion wait for confirmation, and failed writes keep the dialog open', async () => {
  rows[0].canPurgeNow = true; await render('/account-deletion'); await click(button(host, 'Restore account')); assert.equal(mutations().length, 0);
  await click(button(confirmation(), 'Cancel')); assert.equal(mutations().length, 0);
  await click(button(host, 'Delete permanently')); failWrite = true; await click(button(confirmation(), 'Delete immediately'));
  assert.ok(confirmation()); assert.match(confirmation().textContent, /Change unavailable/); assert.equal(mutations()[0].path, '/admin/account-deletion/user-1/purge');
});
test('purge sweep requires confirmation and includes the recovery window', async () => {
  await render('/account-deletion'); await click(button(host, 'Run purge sweep')); assert.equal(mutations().length, 0); assert.match(confirmation().textContent, /30-day recovery window/);
  await click(button(confirmation(), 'Run sweep')); assert.equal(mutations()[0].path, '/admin/account-deletion/run-sweep');
});
test('legal overview summaries match live versions and drafts', async () => {
  await render('/legal'); assert.deepEqual(Array.from(host.querySelectorAll('.legal-summary dd'), (node) => node.textContent), ['1', '1', '2']);
  assert.equal(host.querySelectorAll('.legal-card').length, 2); assert.equal(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '40'); assert.equal(mutations().length, 0);
});
test('legal overview and document failures can be retried', async () => {
  failList = true; await render('/legal'); assert.match(host.querySelector('.legal-error').textContent, /could not be loaded/); failList = false; await click(button(host, 'Try again')); assert.ok(host.querySelector('.legal-card'));
  failDetail = true; await act(async () => router.navigate('/legal/TERMS_OF_SERVICE')); await tick(); assert.ok(host.querySelector('.legal-error'));
  failDetail = false; await click(button(host, 'Try again')); assert.ok(host.querySelector('.legal-draft-banner'));
});
test('version viewer loads immutable content, traps focus and closes with Escape', async () => {
  await render('/legal/TERMS_OF_SERVICE'); const opener = button(host.querySelector('.legal-version-actions'), 'View'); opener.focus(); await click(opener);
  assert.match(modal().querySelector('.legal-doc').textContent, /Saved legal content/); assert.equal(mutations().length, 0);
  const close = modal().querySelector('[aria-label="Close"]'); assert.ok(document.activeElement === close, 'Viewer should receive focus');
  await act(async () => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))); assert.ok(modal().contains(document.activeElement) && document.activeElement !== close, 'Focus should wrap inside the viewer');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await tick(); assert.equal(modal(), null); assert.ok(document.activeElement === opener, 'Viewer should restore focus');
});
test('publishing starts without a selected notification policy and requires the final confirmation', async () => {
  await render('/legal/TERMS_OF_SERVICE'); await click(button(host, 'Publish…')); assert.equal(modal().querySelector('input:checked'), null); assert.equal(button(modal(), 'Continue').disabled, true);
  await click(modal().querySelector('input[type="radio"]')); await click(button(modal(), 'Continue')); assert.equal(mutations().length, 0); assert.match(modal().textContent, /No one will be notified/);
  await click(button(modal(), 'Publish')); const request = mutations()[0]; assert.equal(request.path, '/admin/legal/documents/TERMS_OF_SERVICE/publish'); assert.equal(request.body.notifyUsers, false);
});
test('notify only offers published documents, validates a summary, and preserves the form after failure', async () => {
  await render('/legal'); await click(button(host, 'Notify users')); const choices = modal().querySelectorAll('input[type="checkbox"]'); assert.equal(choices[1].disabled, true);
  await click(choices[0]); assert.equal(button(modal(), 'Continue').disabled, true); await input(modal().querySelector('textarea'), 'Please review these policy updates.');
  await click(button(modal(), 'Continue')); assert.equal(mutations().length, 0); failWrite = true; await click(button(modal(), 'Notify'));
  assert.match(modal().querySelector('[role="alert"]').textContent, /Change unavailable/); assert.equal(modal().querySelector('textarea').value, 'Please review these policy updates.'); assert.equal(modal().querySelector('input[type="checkbox"]').checked, true);
  assert.deepEqual(mutations()[0].body.documentTypes, ['TERMS_OF_SERVICE']);
});
test('mobile editor/preview switching retains draft text and only renders server-sanitized preview output', async () => {
  await render('/legal/TERMS_OF_SERVICE/edit'); await tick(450); await input(host.querySelector('#legal-title'), 'Unsaved title'); await click(button(host, 'HTML'));
  await input(host.querySelector('[aria-label="Document HTML"]'), '<p>New text</p><script>bad()</script>'); await tick(450); await click(button(host.querySelector('.legal-editor-tabs'), 'Preview'));
  assert.equal(host.querySelector('.legal-editor-layout').dataset.view, 'preview'); const preview = host.querySelector('.legal-preview-frame'); assert.match(preview.textContent, /Sanitized preview/); assert.equal(preview.querySelector('script'), null);
  await click(button(host.querySelector('.legal-editor-tabs'), 'Editor')); assert.equal(host.querySelector('#legal-title').value, 'Unsaved title'); assert.match(host.querySelector('[aria-label="Document HTML"]').value, /New text/); assert.equal(button(host, 'Publish…').disabled, true); assert.equal(mutations().length, 0);
});
test('failed legal saves retain the draft, and navigating away still requires confirmation', async () => {
  await render('/legal/TERMS_OF_SERVICE/edit'); await input(host.querySelector('#legal-title'), 'Retained draft'); failWrite = true; await click(button(host, 'Save draft')); assert.equal(host.querySelector('#legal-title').value, 'Retained draft');
  await click(host.querySelector('#test-navigation')); assert.ok(confirmation()); assert.match(confirmation().textContent, /Unsaved|unsaved/); await click(button(confirmation(), 'Stay'));
  assert.equal(router.state.location.pathname, '/legal/TERMS_OF_SERVICE/edit'); assert.equal(host.querySelector('#legal-title').value, 'Retained draft');
  await click(host.querySelector('#test-navigation')); await click(button(confirmation(), 'Leave')); assert.equal(router.state.location.pathname, '/legal');
});
test('background document refresh errors leave the unsaved editor mounted', async () => {
  await render('/legal/TERMS_OF_SERVICE/edit'); await input(host.querySelector('#legal-title'), 'Keep my draft'); const editor = host.querySelector('.legal-editable');
  failDetail = true; await act(async () => client.invalidateQueries({ queryKey: ['adminLegalDocument'] })); await tick(); assert.ok(host.querySelector('.legal-error')); assert.ok(host.querySelector('.legal-editable') === editor, 'Refresh errors must not remount the editing surface'); assert.equal(host.querySelector('#legal-title').value, 'Keep my draft');
});

test('publishing with notification validates the summary and preserves it when publishing fails', async () => {
  await render('/legal/TERMS_OF_SERVICE'); await click(button(host, 'Publish…')); await click(modal().querySelectorAll('input[type="radio"]')[1]);
  assert.equal(button(modal(), 'Continue').disabled, true); await input(modal().querySelector('textarea'), '  Clearer policy wording for students.  '); await click(button(modal(), 'Continue'));
  assert.equal(mutations().length, 0); failWrite = true; await click(button(modal(), 'Publish and notify'));
  assert.ok(modal()); assert.equal(modal().querySelector('textarea').value, '  Clearer policy wording for students.  '); assert.match(modal().querySelector('[role="alert"]').textContent, /Change unavailable/);
  assert.deepEqual(mutations()[0].body, { notifyUsers: true, changeSummary: 'Clearer policy wording for students.' });
});
test('draft restoration stays blocked while a draft is open, and discarding requires confirmation', async () => {
  await render('/legal/TERMS_OF_SERVICE'); assert.equal(button(host, 'Restore as draft').disabled, true);
  await act(async () => router.navigate('/legal/TERMS_OF_SERVICE/edit')); await tick(); await input(host.querySelector('#legal-title'), 'Unsaved change');
  await click(button(host, 'Discard')); assert.equal(mutations().length, 0); await click(button(confirmation(), 'Discard draft')); await tick();
  assert.equal(mutations()[0].method, 'DELETE'); assert.equal(mutations().length, 1, 'Discard must not silently reopen a draft'); assert.equal(router.state.location.pathname, '/legal/TERMS_OF_SERVICE'); assert.equal(confirmation(), null);
});
test('preview failures offer retry without clearing the open draft', async () => {
  failPreview = true; await render('/legal/TERMS_OF_SERVICE/edit'); await tick(450); await input(host.querySelector('#legal-title'), 'Draft preserved');
  await click(button(host.querySelector('.legal-editor-tabs'), 'Preview')); const frame = host.querySelector('.legal-preview-frame'); assert.match(frame.textContent, /preview could not be loaded/);
  failPreview = false; await click(button(frame, 'Try again')); assert.match(frame.textContent, /Sanitized preview/); assert.equal(host.querySelector('#legal-title').value, 'Draft preserved'); assert.equal(mutations().length, 0);
});


test('opening an editor without a draft creates it once and seeds the returned text', async () => {
  detail.draft = null; await render('/legal/TERMS_OF_SERVICE/edit'); await tick();
  assert.equal(mutations().filter(({ method }) => method === 'POST').length, 1);
  assert.equal(host.querySelector('#legal-title').value, 'Terms of Service');
  assert.match(host.querySelector('.legal-editable').textContent, /Saved legal content/);
  await act(async () => client.invalidateQueries({ queryKey: ['adminLegalDocument'] })); await tick();
  assert.equal(mutations().filter(({ method }) => method === 'POST').length, 1);
});


test('changing legal documents resets editor view and content only after leaving is confirmed', async () => {
  await render('/legal/TERMS_OF_SERVICE/edit'); await input(host.querySelector('#legal-title'), 'Unsaved Terms'); await click(button(host, 'HTML'));
  await act(async () => router.navigate('/legal/PRIVACY_POLICY/edit')); await tick(); assert.ok(confirmation()); assert.equal(host.querySelector('#legal-title').value, 'Unsaved Terms');
  await click(button(confirmation(), 'Leave')); await tick(); assert.equal(host.querySelector('#legal-title').value, 'Privacy draft'); assert.equal(host.querySelector('[aria-label="Document HTML"]'), null); assert.equal(host.querySelector('.legal-editor-layout').dataset.view, 'edit'); assert.equal(mutations().length, 0);
});
test('a pending sweep disables other deletion actions until it finishes', async () => {
  await render('/account-deletion'); await click(button(host, 'Run purge sweep')); let release; gate = new Promise((resolve) => { release = resolve; });
  await click(button(confirmation(), 'Run sweep')); assert.equal(button(host, 'Restore account').disabled, true); assert.equal(mutations().length, 1);
  release(); await tick(); assert.equal(confirmation(), null);
});
