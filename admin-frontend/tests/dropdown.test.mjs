// Run: node --test admin-frontend/tests/dropdown.test.mjs
// Reuses the repository's existing frontend jsdom, with admin React and Vite.
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createServer } from 'vite';

const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { JSDOM } = requireFrontend('jsdom');
let server, root, host, Dropdown;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLSelectElement', 'HTMLOptGroupElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) {
  globalThis[name] = dom.window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const element = React.createElement;
const options = [
  element('option', { key: '', value: '' }, 'All statuses'),
  element('option', { key: 'open', value: 'OPEN' }, 'Open'),
  element('option', { key: 'closed', value: 'CLOSED', disabled: true }, 'Closed'),
  element('option', { key: 'resolved', value: 'RESOLVED' }, 'Resolved'),
];
const trigger = () => host.querySelector('[role="combobox"]');
const list = () => document.querySelector('[role="listbox"]');
async function render(props = {}) {
  if (!host) { host = document.createElement('form'); document.body.append(host); root = createRoot(host); }
  await act(() => root.render(element(Dropdown, { 'aria-label': 'Ticket status', value: '', onChange: () => {}, ...props }, options)));
  trigger().getBoundingClientRect = () => ({ left: 20, right: 220, top: 80, bottom: 122, width: 200, height: 42 });
}
async function key(value) { await act(() => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))); }
async function click(target) { await act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true }, appType: 'custom', esbuild: { jsx: 'automatic' } });
  ({ Dropdown } = await server.ssrLoadModule('/src/components/Dropdown.tsx'));
});
afterEach(async () => { if (root) await act(() => root.unmount()); root = null; host?.remove(); host = null; });
after(async () => { await server?.close(); dom.window.close(); });

test('selects through the original native change event, and preserves form values', async () => {
  let received;
  await render({ name: 'status', onChange: (event) => { received = { value: event.target.value, tag: event.target.tagName }; } });
  await click(trigger());
  assert.equal(trigger().getAttribute('aria-expanded'), 'true');
  assert.equal(list().querySelectorAll('[role="option"]').length, 4);
  await click(list().querySelector('[data-index="1"]'));
  assert.deepEqual(received, { value: 'OPEN', tag: 'SELECT' });
  assert.equal(list(), null);
  await render({ value: 'OPEN', name: 'status' });
  assert.equal(trigger().textContent, 'Open');
  assert.equal(new dom.window.FormData(host).get('status'), 'OPEN');
});

test('keyboard navigation skips disabled items and commits only on Enter', async () => {
  const values = [];
  await render({ onChange: (event) => values.push(event.target.value) });
  await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown');
  assert.match(trigger().getAttribute('aria-activedescendant'), /-3$/);
  assert.deepEqual(values, []);
  await key('Enter');
  assert.deepEqual(values, ['RESOLVED']);
});

test('Escape, Tab, and outside pointer dismiss without selecting', async () => {
  const values = [];
  await render({ onChange: (event) => values.push(event.target.value) });
  await click(trigger()); await key('Escape'); assert.equal(list(), null);
  await click(trigger()); await key('Tab'); assert.equal(list(), null);
  await click(trigger());
  await act(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  assert.equal(list(), null); assert.deepEqual(values, []);
});

test('disabled controls/options do not change values; dynamic options update', async () => {
  const values = [];
  await render({ disabled: true, onChange: (event) => values.push(event.target.value) });
  await click(trigger()); assert.equal(list(), null);
  await render({ onChange: (event) => values.push(event.target.value) });
  await click(trigger()); await click(list().querySelector('[data-index="2"]'));
  assert.deepEqual(values, []);
  await act(() => root.render(element(Dropdown, { 'aria-label': 'Ticket status', value: 'NEW', onChange: () => {} }, element('option', { value: 'NEW' }, 'New option'))));
  assert.equal(trigger().textContent, 'New option');
});

test('typeahead, Home/End, and empty values remain usable', async () => {
  await render(); await key('r');
  assert.match(trigger().getAttribute('aria-activedescendant'), /-3$/);
  await key('Home'); assert.match(trigger().getAttribute('aria-activedescendant'), /-0$/);
  await key('End'); assert.match(trigger().getAttribute('aria-activedescendant'), /-3$/);
  await key('Escape'); assert.equal(trigger().textContent, 'All statuses');
});

test('popup matches trigger width, flips upward and stays inside a narrow viewport', async () => {
  await render();
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
  trigger().getBoundingClientRect = () => ({ left: 280, right: 430, top: 680, bottom: 722, width: 150, height: 42 });
  try {
    await click(trigger());
    assert.equal(list().style.width, '150px');
    assert.equal(list().style.left, '162px');
    assert.equal(list().style.bottom, '94px');
    assert.equal(list().style.top, '');
  } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth }); }
});

test('Home/End work from closed, blur closes, and empty option sets stay closed', async () => {
  await render(); await key('End');
  assert.match(trigger().getAttribute('aria-activedescendant'), /-3$/);
  await act(() => { trigger().focus(); trigger().blur(); }); assert.equal(list(), null);
  await act(() => root.render(element(Dropdown, { value: '', onChange: () => {}, 'aria-label': 'Empty' })));
  await click(trigger()); assert.equal(list(), null);
});

test('dialog dropdowns keep their listbox inside the dialog accessibility boundary', async () => {
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog);
  try {
    host = document.createElement('form'); dialog.append(host); root = createRoot(host);
    await render(); await click(trigger());
    assert.equal(dialog.contains(list()), true);
    assert.equal(trigger().getAttribute('aria-label'), 'Ticket status');
  } finally { await act(() => root.unmount()); root = null; host = null; dialog.remove(); }
});

test('reselecting does not emit a change or submit a form, and disabling closes an open menu', async () => {
  let changes = 0, submits = 0;
  await render({ onChange: () => { changes++; } });
  host.addEventListener('submit', (event) => { event.preventDefault(); submits++; });
  await click(trigger()); await key('Enter');
  assert.equal(changes, 0); assert.equal(submits, 0);
  await click(trigger()); assert.ok(list());
  await render({ disabled: true }); assert.equal(list(), null);
});

test('scrolling the page dismisses the popup; scrolling its options does not', async () => {
  await render(); await click(trigger());
  await act(() => list().dispatchEvent(new Event('scroll'))); assert.ok(list());
  await act(() => document.dispatchEvent(new Event('scroll'))); assert.equal(list(), null);
});

test('explicit visible labels target the custom trigger, not the form backing select', async () => {
  await render({ id: 'labelled-dropdown' });
  const label = document.createElement('label'); label.htmlFor = 'labelled-dropdown'; label.textContent = 'Status'; host.prepend(label);
  assert.equal(label.control, trigger());
  assert.equal(host.querySelector('select').getAttribute('aria-hidden'), 'true');
});

test('highlighting scrolls only the listbox and selection restores focus without scrolling', async () => {
  await render();
  let outerScrolls = 0;
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = () => { outerScrolls++; };
  try {
    await click(trigger());
    const menu = list();
    Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 36 });
    Array.from(menu.querySelectorAll('[role="option"]')).forEach((option, index) => {
      Object.defineProperty(option, 'offsetTop', { configurable: true, value: index * 36 });
      Object.defineProperty(option, 'offsetHeight', { configurable: true, value: 36 });
    });
    await key('End');
    assert.equal(menu.scrollTop, 108);
    assert.equal(outerScrolls, 0);
    const focus = trigger().focus;
    let focusOptions;
    trigger().focus = function (options) { focusOptions = options; return focus.call(this, options); };
    await key('Enter');
    assert.equal(list(), null);
    assert.deepEqual(focusOptions, { preventScroll: true });
  } finally {
    if (original) HTMLElement.prototype.scrollIntoView = original;
    else delete HTMLElement.prototype.scrollIntoView;
  }
});
