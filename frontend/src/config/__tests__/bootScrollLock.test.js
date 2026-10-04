// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

/**
 * The launch shell in index.html locks scrolling until the app is ready, and
 * React mounts BEHIND it by design. Anything that mounts in that window and
 * saves an inline `overflow` to restore later (LandingPage, an overlay's scroll
 * lock) must not be able to capture the boot lock as the "original" value.
 *
 * It could when the lock was written inline: the component saved `clip`, the
 * shell released, and the component's cleanup wrote `clip` back, so the site
 * would not scroll until a reload.
 */
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

const bootScript = (() => {
  const scripts = [...INDEX_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = scripts.find((s) => s.includes('__meetifyyBoot'));
  if (!found) throw new Error('launch shell script not found in index.html');
  return found;
})();

describe('launch shell scroll lock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    document.body.innerHTML = '<div id="launch-shell"></div><div id="root"></div>';
    delete window.__meetifyyBoot;
    delete window.__meetifyyVersionGate;
  });

  it('cannot be captured by a component that saves and restores inline overflow', () => {
    new Function(bootScript)();

    // A component mounting behind the shell, written the way LandingPage was.
    const savedHtml = document.documentElement.style.overflow;
    const savedBody = document.body.style.overflow;
    document.documentElement.style.overflow = 'auto';

    // The app finishes booting; the shell lifts and releases its lock.
    document.getElementById('root').appendChild(document.createElement('main'));
    window.__meetifyyBoot.ready();
    vi.advanceTimersByTime(1000); // past the shell's minimum on-screen time

    // The component unmounts later and restores what it saved.
    document.documentElement.style.overflow = savedHtml;
    document.body.style.overflow = savedBody;

    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
  });
});
