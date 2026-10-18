import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The cookie banner hides itself while the legal-update gate is up, by a CSS
 * rule on the gate's `data-legal-gate` attribute. The attribute is what every
 * state of the gate carries, including the 'confirming' skeleton (which has no
 * dialog labels); LegalUpdateGate.test pins that the skeleton renders it.
 */
const css = readFileSync(
  fileURLToPath(new URL('../CookieBanner.module.css', import.meta.url)),
  'utf8',
);

describe('cookie banner and the legal-update gate', () => {
  it('hides the banner whenever the gate wrapper is on the page', () => {
    expect(css).toMatch(/body:has\(\[data-legal-gate\][^)]*\)\)\s*\.bannerBackdrop\s*\{\s*display:\s*none/);
  });
});
