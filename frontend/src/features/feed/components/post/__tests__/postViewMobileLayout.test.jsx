/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import HeaderScrollEdge from '@shared/components/ui/HeaderScrollEdge';

/**
 * Why the post view did not load on phones.
 *
 * `.centre--sheet > *` gives every direct child of a sheet page
 * `min-height: 100dvh`, so the sheet's surface fills the viewport and the body
 * canvas cannot show through underneath it. The post route has TWO children:
 * the surface, and `HeaderScrollEdge` — a 16px decorative overlay that is
 * deliberately a sibling rather than a child, because the surface's
 * `overflow: hidden` would clip it and steal its sticky anchor.
 *
 * That `> *` caught the overlay too. Measured on the route at 375x812, the
 * 16px edge became 812px tall and the post started 796px down the page: one
 * entirely blank screen, which reads as "the post did not load" rather than as
 * something to scroll past. It reproduced on every viewport <= 768px — phones
 * and small tablets — and never above it, which is exactly the reported shape.
 *
 * jsdom does no layout, so these assert the two halves of the contract that
 * produced it rather than the pixels; the pixel measurement was taken in a real
 * browser at each breakpoint.
 */
describe('post view on mobile', () => {
  it('marks the scroll edge as a decorative overlay', () => {
    const { container } = render(<HeaderScrollEdge gap="1rem" />);
    const edge = container.firstChild;
    expect(edge.hasAttribute('data-sheet-overlay')).toBe(true);
    // Still inert and unannounced — the marker is for layout, not semantics.
    expect(edge.getAttribute('aria-hidden')).toBe('true');
  });

  it('exempts overlays from the sheet rule that stretches children to 100dvh', () => {
    // Resolved from the project root (vitest's cwd) rather than from this
    // file's URL: the transform can rewrite import.meta.url to a non-file
    // scheme, and the stylesheet's location is not what this test is about.
    const css = readFileSync(resolve('src/styles/global.css'), 'utf8');

    // The rule must still exist: it is what stops the body canvas showing
    // through under a short sheet page.
    expect(css).toMatch(/\.centre--sheet\s*>\s*\*[^{]*\{[^}]*min-height:\s*100dvh/);

    // And it must exclude overlays. A bare `> *` is the bug.
    const rule = css.match(/\.centre--sheet\s*>\s*\*[^{]*\{[^}]*min-height:\s*100dvh[^}]*\}/)[0];
    expect(rule).toContain(':not([data-sheet-overlay])');
  });

  it('keeps the overlay out of the flow via its own negative margin', () => {
    // The edge cancels its height plus the parent's gap, which is what makes it
    // occupy no layout space at all once it is no longer being stretched.
    const { container } = render(<HeaderScrollEdge gap="1rem" />);
    expect(container.firstChild.style.getPropertyValue('--edge-gap')).toBe('1rem');
  });
});
