// jsdom shims the real components rely on.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

globalThis.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
};
globalThis.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
};
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
window.scrollTo = () => {};

afterEach(() => cleanup());
