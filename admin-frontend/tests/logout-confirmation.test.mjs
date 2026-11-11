// Run: node --test admin-frontend/tests/logout-confirmation.test.mjs
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
const { JSDOM } = createRequire(new URL('../../frontend/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
let server, root, host, client, AdminLayout, ConfirmProvider;
let logoutCalls = 0;
globalThis.__logoutFixture = { admin: { name: 'Admin', email: 'admin@example.invalid' }, logout: async () => { logoutCalls++; } };
const element = React.createElement;
const dialog = () => document.querySelector('[role="alertdialog"]');
async function click(target) { assert.ok(target); await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
async function render(width) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => root.render(element(QueryClientProvider, { client }, element(ConfirmProvider, null, element(MemoryRouter, { initialEntries: ['/dashboard'] }, element(AdminLayout))))));
}
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', esbuild: { jsx: 'automatic' }, plugins: [{
    name: 'logout-test-fixtures', enforce: 'pre',
    resolveId(source) {
      if (/\/context\/AuthContext(?:\.tsx)?$/.test(source)) return '\0test-auth';
      if (/\/api\/apiClient(?:\.ts)?$/.test(source)) return '\0test-api';
    },
    load(id) {
      if (id === '\0test-auth') return 'export const useAuth = () => globalThis.__logoutFixture;';
      if (id === '\0test-api') return 'export const apiRequest = async () => ({data: []});';
    },
  }] });
  ({ AdminLayout } = await server.ssrLoadModule('/src/components/AdminLayout.tsx'));
  ({ ConfirmProvider } = await server.ssrLoadModule('/src/components/ConfirmProvider.tsx'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); host?.remove(); root = null; logoutCalls = 0; });
after(async () => { await server?.close(); delete globalThis.__logoutFixture; dom.window.close(); });

test('desktop toggles preserve navigation nodes, section space and scroll state', async () => {
  await render(1440);
  const sidebar = host.querySelector('#admin-sidebar');
  const toggle = sidebar.querySelector('.admin-rail-toggle');
  const navigation = sidebar.querySelector('nav');
  const icons = Array.from(navigation.querySelectorAll('.admin-nav-icon'));
  const labels = Array.from(navigation.querySelectorAll('.admin-nav-label'));
  const headings = Array.from(navigation.querySelectorAll('.admin-nav-group-title'));
  assert.equal(icons.length, 12);
  assert.equal(headings.length, 3);
  navigation.scrollTop = 120;
  toggle.focus();
  for (const expanded of [true, false, true, false]) {
    await click(toggle);
    assert.equal(sidebar.dataset.expanded, String(expanded));
    assert.equal(toggle.getAttribute('aria-expanded'), String(expanded));
    for (const [selector, original] of [['.admin-nav-icon', icons], ['.admin-nav-label', labels], ['.admin-nav-group-title', headings]]) {
      const current = navigation.querySelectorAll(selector);
      assert.equal(current.length, original.length);
      assert.ok(original.every((node, index) => node === current[index]), `${selector} stays mounted`);
    }
    assert.ok(labels.every((label) => label.getAttribute('aria-hidden') === String(!expanded)));
    assert.equal(navigation.scrollTop, 120);
    assert.ok(document.activeElement === toggle);
    assert.equal(navigation.querySelector('[aria-label="Users"]').getAttribute('title'), expanded ? null : 'Users');
  }
});

test('mobile closing retains the backdrop for its fade and immediately disables the drawer', async () => {
  await render(390);
  const menu = host.querySelector('[aria-label="Open navigation"]');
  const sidebar = host.querySelector('#admin-sidebar');
  const backdrop = host.querySelector('.admin-drawer-backdrop');
  assert.equal(backdrop.dataset.open, 'false');
  await click(menu);
  assert.equal(backdrop.dataset.open, 'true');
  assert.equal(sidebar.hasAttribute('inert'), false);
  await click(backdrop);
  assert.ok(host.querySelector('.admin-drawer-backdrop') === backdrop);
  assert.equal(backdrop.dataset.open, 'false');
  assert.equal(sidebar.hasAttribute('inert'), true);
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.ok(document.activeElement === menu);
  await click(menu);
  await click(sidebar.querySelector('[aria-label="Close navigation"]'));
  assert.equal(backdrop.dataset.open, 'false');
  assert.equal(sidebar.hasAttribute('inert'), true);
});

test('desktop logout waits for confirmation, cancellation preserves sign-in', async () => {
  await render(1440);
  const button = host.querySelector('[aria-label="Log out"]'); button.focus(); await click(button);
  assert.ok(dialog()); assert.equal(logoutCalls, 0);
  await click(Array.from(dialog().querySelectorAll('button')).find((item) => item.textContent === 'Stay signed in'));
  assert.equal(dialog(), null); assert.equal(logoutCalls, 0); assert.equal(document.activeElement, button);
  await click(button);
  await click(Array.from(dialog().querySelectorAll('button')).find((item) => item.textContent === 'Log out'));
  assert.equal(logoutCalls, 1); assert.equal(dialog(), null);
});

test('mobile header logout uses the same confirmation', async () => {
  await render(390); await click(host.querySelector('.admin-mobile-header [aria-label="Log out"]'));
  assert.ok(dialog()); assert.equal(logoutCalls, 0);
  await click(Array.from(dialog().querySelectorAll('button')).find((item) => item.textContent === 'Log out'));
  assert.equal(logoutCalls, 1);
});

test('mobile drawer closes before confirming, Escape cancels and restores menu focus', async () => {
  await render(390);
  const menu = host.querySelector('[aria-label="Open navigation"]'); await click(menu);
  assert.equal(menu.getAttribute('aria-expanded'), 'true');
  await click(host.querySelector('#admin-sidebar [aria-label="Log out"]'));
  assert.equal(menu.getAttribute('aria-expanded'), 'false'); assert.ok(dialog()); assert.equal(logoutCalls, 0);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(dialog(), null); assert.equal(logoutCalls, 0); assert.equal(document.activeElement, menu);
});

test('confirmations lock the workspace and keep focus inside without moving its scroll position', async () => {
  await render(1280);
  const surface = host.querySelector('.admin-content-surface');
  surface.scrollTop = 240;
  surface.style.overflow = 'auto';
  const previousBody = document.body.style.overflow;
  const previousHtml = document.documentElement.style.overflow;
  await click(host.querySelector('[aria-label="Log out"]'));
  assert.equal(surface.style.overflow, 'hidden');
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.documentElement.style.overflow, 'hidden');
  assert.equal(surface.scrollTop, 240);
  const controls = Array.from(dialog().querySelectorAll('button:not([disabled])'));
  controls.at(-1).focus();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
  assert.equal(document.activeElement, controls[0]);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(dialog(), null);
  assert.equal(surface.style.overflow, 'auto');
  assert.equal(surface.scrollTop, 240);
  assert.equal(document.body.style.overflow, previousBody);
  assert.equal(document.documentElement.style.overflow, previousHtml);
  assert.equal(logoutCalls, 0);
});
