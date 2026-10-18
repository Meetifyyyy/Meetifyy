/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  fileURLToPath(new URL('./ProfileCompletionModal.module.css', import.meta.url)),
  'utf8',
);

/** Bodies of every rule whose selector list contains `selector` exactly. */
const ruleFor = (selector) => {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let out = '';
  for (const m of css.matchAll(re)) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    if (sels.includes(selector)) out += m[2];
  }
  return out;
};

describe('gender option states do not stack', () => {
  it('selected state is tint + border only: no inset ring, no transform', () => {
    for (const sel of ['.optionActive', ':global([data-theme="dark"]) .optionActive']) {
      const body = ruleFor(sel);
      expect(body).toMatch(/border-color:/);
      expect(body).toMatch(/background:/);
      expect(body).toMatch(/box-shadow:\s*none/);
      expect(body).not.toMatch(/inset/);
    }
  });

  it('hover exists only for fine pointers and never applies to the selected option', () => {
    const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
    expect(outside).not.toMatch(/\.option:hover/);
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)/);
    expect(css).toMatch(/\.option:hover:not\(\.optionActive\)/);
  });

  it('has no pressed scale and no focus ring after a pointer click', () => {
    expect(ruleFor('.option:active')).toMatch(/transform:\s*none/);
    expect(ruleFor('.option:focus:not(:focus-visible)')).toMatch(/outline:\s*none/);
    expect(ruleFor('.option:focus-visible')).toMatch(/outline:/);
    expect(ruleFor('.option')).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
  });
});
