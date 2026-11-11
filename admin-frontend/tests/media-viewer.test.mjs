// Run: node --test admin-frontend/tests/media-viewer.test.mjs
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { JSDOM } = requireFrontend('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/verification' });
for (const name of ['window', 'document', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const element = React.createElement;
let server, host, root, MediaViewer, VerificationDocument;
let calls = [], openedTabs = 0, closed = 0;
const originalOpen = window.open;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network access is forbidden in UI unit tests'); };
window.open = () => { openedTabs++; return null; };
let request = async () => ({ idCard: { url: 'https://media.invalid/fresh.jpg' }, selfie: { url: 'https://media.invalid/selfie.jpg' } });
globalThis.__verificationRequest = (url) => { calls.push(url); return request(url); };
function ViewerHarness({ props }) {
  const [open, setOpen] = React.useState(false);
  return element(React.Fragment, null,
    element('button', { onClick: () => setOpen(true) }, 'Open test viewer'),
    open && element(MediaViewer, { title: 'College ID', alt: 'College ID', src: 'https://media.invalid/image.jpg', ...props, onClose: () => { closed++; setOpen(false); } }),
  );
}
function ensureRoot() { if (!host) { host = document.createElement('div'); host.id = 'root'; host.inert = false; document.body.append(host); root = createRoot(host); } }
async function click(target) { assert.ok(target); await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
const dialog = () => document.querySelector('[role="dialog"]');
const control = (label) => document.querySelector(`[aria-label="${label}"]`);
async function key(value, options = {}) { await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...options }))); }
async function viewer(props = {}) { ensureRoot(); await act(async () => root.render(element(ViewerHarness, { props }))); if (!dialog()) { host.querySelector('button').focus(); await click(host.querySelector('button')); } }
async function documentPreview(props = {}) {
  ensureRoot(); await act(async () => root.render(element(VerificationDocument, { requestId: 'request-1', kind: 'idCard', label: 'College ID', alt: 'College ID', emptyText: 'No ID uploaded', media: { url: 'https://media.invalid/current.jpg' }, issuedAt: Date.now(), ...props })));
}
async function loadImage() {
  const image = dialog().querySelector('img');
  Object.defineProperty(image, 'naturalWidth', { value: 1600 }); Object.defineProperty(image, 'naturalHeight', { value: 900 });
  await act(async () => image.dispatchEvent(new Event('load'))); return image;
}
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{
    name: 'verification-test-transport',
    enforce: 'pre',
    resolveId(source) { if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0verification-test-api'; },
    load(id) { if (id === '\0verification-test-api') return 'export const apiRequest = (...args) => globalThis.__verificationRequest(...args);'; },
  }] });
  ({ MediaViewer } = await server.ssrLoadModule('/src/components/MediaViewer.tsx'));
  ({ default: VerificationDocument } = await server.ssrLoadModule('/src/pages/VerificationDocument.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; host?.remove(); host = null; calls = []; closed = 0; openedTabs = 0; request = async () => ({ idCard: { url: 'https://media.invalid/fresh.jpg' }, selfie: { url: 'https://media.invalid/selfie.jpg' } }); });
after(async () => { await server?.close(); window.open = originalOpen; globalThis.fetch = originalFetch; delete globalThis.__verificationRequest; dom.window.close(); });

test('modal locks the background, closes with Escape, and restores focus/scroll', async () => {
  document.body.style.overflow = 'auto';
  await viewer(); assert.equal(host.inert, true); assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement, control('Close media viewer'));
  await key('Escape'); assert.equal(dialog(), null); assert.equal(closed, 1);
  assert.equal(host.inert, false); assert.equal(document.body.style.overflow, 'auto'); assert.equal(document.activeElement, host.querySelector('button'));
});

test('keyboard focus stays inside the modal and backdrop only closes on its own surface', async () => {
  await viewer(); await loadImage();
  const first = dialog().querySelector('button:not([disabled])');
  const stage = control('Image viewing area');
  first.focus(); await key('Tab', { shiftKey: true }); assert.equal(document.activeElement, stage);
  await key('Tab'); assert.equal(document.activeElement, first);
  await click(dialog().querySelector('h2')); assert.ok(dialog());
  await click(document.querySelector('.media-viewer-backdrop')); assert.equal(dialog(), null);
});

test('zoom uses actual image bounds, Fit resets, and source revisions reload safely', async () => {
  await viewer(); const image = await loadImage(); const initialWidth = parseFloat(image.style.width);
  await click(control('Zoom in')); assert.equal(parseFloat(image.style.width), initialWidth * 1.5);
  await click(Array.from(dialog().querySelectorAll('button')).find((button) => button.textContent === 'Fit'));
  assert.equal(parseFloat(image.style.width), initialWidth);
  await viewer({ revision: 1 }); assert.notEqual(dialog().querySelector('img'), image); assert.ok(dialog().querySelector('[role="status"]'));
});

test('fresh verification images open locally without a signing call or browser tab', async () => {
  await documentPreview(); await click(host.querySelector('.verification-preview-button'));
  assert.ok(dialog()); assert.equal(dialog().querySelector('img').src, 'https://media.invalid/current.jpg');
  assert.deepEqual(calls, []); assert.equal(openedTabs, 0); assert.equal(window.location.pathname, '/verification');
  await click(control('Close media viewer')); await click(host.querySelector('.verification-media-ext-link')); assert.ok(dialog());
});

test('stale documents reuse the existing refresh endpoint before displaying', async () => {
  await documentPreview({ issuedAt: 0 }); await click(host.querySelector('.verification-preview-button'));
  assert.deepEqual(calls, ['/admin/verification/requests/request-1/documents']);
  assert.equal(dialog().querySelector('img').src, 'https://media.invalid/fresh.jpg'); assert.equal(openedTabs, 0);
});

test('refresh failure stays inside the viewer and manual retry recovers', async () => {
  request = async () => { throw new Error('unavailable'); };
  await documentPreview({ issuedAt: 0 }); await click(host.querySelector('.verification-preview-button'));
  assert.ok(dialog().querySelector('[role="alert"]'));
  request = async () => ({ idCard: { url: 'https://media.invalid/retried.jpg' } });
  await click(Array.from(dialog().querySelectorAll('button')).find((button) => button.textContent === 'Retry'));
  assert.equal(dialog().querySelector('img').src, 'https://media.invalid/retried.jpg'); assert.equal(calls.length, 2);
});

test('closing during refresh never reopens the viewer after the response', async () => {
  let resolve;
  request = () => new Promise((done) => { resolve = done; });
  await documentPreview({ issuedAt: 0 }); await click(host.querySelector('.verification-preview-button'));
  assert.match(dialog().textContent, /Refreshing/);
  await click(control('Close media viewer'));
  await act(async () => resolve({ idCard: { url: 'https://media.invalid/later.jpg' } }));
  assert.equal(dialog(), null); assert.equal(host.inert, false); assert.equal(openedTabs, 0);
});

test('viewer image errors retain the existing single automatic retry policy', async () => {
  await documentPreview(); await click(host.querySelector('.verification-preview-button'));
  await act(async () => dialog().querySelector('img').dispatchEvent(new Event('error')));
  assert.equal(calls.length, 1);
  await act(async () => dialog().querySelector('img').dispatchEvent(new Event('error')));
  assert.equal(calls.length, 1); assert.ok(dialog().querySelector('[role="alert"]'));
});

test('missing documents remain non-interactive with an explicit empty state', async () => {
  await documentPreview({ media: null });
  assert.match(host.textContent, /No ID uploaded/); assert.equal(host.querySelector('.verification-preview-button'), null); assert.equal(dialog(), null);
});

test('live selfie refresh opens the corresponding private image in the same viewer', async () => {
  await documentPreview({ kind: 'selfie', label: 'Live selfie', alt: 'Live selfie', issuedAt: 0 });
  await click(host.querySelector('.verification-preview-button'));
  assert.equal(dialog().querySelector('img').src, 'https://media.invalid/selfie.jpg');
  assert.equal(dialog().querySelector('h2').textContent, 'Live selfie'); assert.equal(openedTabs, 0);
});
