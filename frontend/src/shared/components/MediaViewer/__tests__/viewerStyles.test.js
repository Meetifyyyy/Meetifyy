import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adaptMediaQuery } from '../../../../mobile/landscapePhoneMedia.js';
import { withNativeNavigationInset } from '../../../../mobile/safeAreaPostcss.js';

const css = readFileSync(new URL('../MediaViewer.module.css', import.meta.url), 'utf8');
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
};

describe('viewer stylesheet', () => {
  it('compacts the video controls on a landscape phone (MV-021)', () => {
    const query = '(max-width: 600px), (pointer: coarse) and (max-height: 500px)';
    expect(css).toContain(`@media ${query} {`);
    // The app's landscape adapter must leave this list exactly as written.
    expect(adaptMediaQuery(query)).toBe(query);
  });

  it('pads the video controls and gradient by the bottom inset (MV-019)', () => {
    expect(block('.videoControlsRow')).toContain('calc(0.85rem + env(safe-area-inset-bottom, 0px))');
    expect(block('.videoGradient')).toContain('calc(110px + env(safe-area-inset-bottom, 0px))');
    const compact = css.slice(css.indexOf('@media (max-width: 600px), (pointer: coarse)'));
    expect(compact).toContain('calc(0.7rem + env(safe-area-inset-bottom, 0px))');
    // The mobile build folds the navigation bar in once, via max(), not a sum.
    const rewritten = withNativeNavigationInset('calc(0.85rem + env(safe-area-inset-bottom, 0px))');
    expect(rewritten).toContain('max(env(safe-area-inset-bottom, 0px), var(--navigation-bar-inset, 0px))');
    expect(rewritten.match(/--navigation-bar-inset/g)).toHaveLength(1);
  });

  it('never hides the paging buttons on touch or narrow windows (MV-018)', () => {
    expect(css).not.toMatch(/@media \(max-width: 768px\), \(pointer: coarse\)/);
    const hidden = [...css.matchAll(/@media[^{]*\{[^{}]*\.navBtn\s*\{[^}]*display:\s*none/g)];
    expect(hidden).toHaveLength(0);
  });

  it('stops the scripted slide, image and zoom motion under reduced motion (MV-037)', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const rule = reduced.slice(reduced.indexOf('{') + 1, reduced.indexOf('}'));
    for (const selector of ['.stageTrack', '.imageWrap', '.mediaImage', '.zoomControls']) {
      expect(rule).toContain(selector);
    }
    expect(rule).toContain('transition: none !important');
  });
});
