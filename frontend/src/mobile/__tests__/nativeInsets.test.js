import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { safeAreaPostcss } from '../safeAreaPostcss';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(src, rel), 'utf8');
const NATIVE_BOTTOM = 'var(--navigation-bar-inset, 0px)';

/** The declarations of the first rule matching `selector` inside a media query containing `media`. */
async function ruleIn(css, media, selector) {
  const root = postcss.parse(css);
  let found = null;
  root.walkAtRules('media', (atRule) => {
    if (found || !atRule.params.includes(media)) return;
    atRule.walkRules(selector, (rule) => {
      if (!found) found = rule;
    });
  });
  return found;
}

describe('the instant-notification toaster on phones', () => {
  it('sits below the status bar using whichever inset the platform reports', async () => {
    const rule = await ruleIn(read('styles/global.css'), 'max-width: 768px', '[data-sonner-toaster][data-y-position="top"]');
    const top = rule.nodes.find((n) => n.prop === 'top').value;

    // The installed app publishes the bar height as --status-bar-inset and
    // reports env() as 0; the browser/PWA does the reverse. Both must count.
    expect(top).toContain('env(safe-area-inset-top');
    expect(top).toContain('--status-bar-inset');
    expect(top).toMatch(/max\(/);
  });
});

describe('the Create Community sheet on phones', () => {
  it('clears the system navigation bar at its bottom edge', async () => {
    const css = read('features/communities/components/modals/CreateCommunityModal.module.css');
    const out = await postcss([safeAreaPostcss()]).process(css, { from: undefined });
    const rule = await ruleIn(out.css, 'max-width: 640px', '.modal');
    const padding = rule.nodes.find((n) => n.prop === 'padding').value;

    // After the mobile build's PostCSS the bottom padding includes the native bar.
    expect(padding).toContain(NATIVE_BOTTOM);
  });
});

describe('the Communities page on phones', () => {
  it('does not reserve the bottom bar twice', async () => {
    const css = read('features/communities/pages/CommunitiesRoute.module.css');
    const box = await ruleIn(css, 'max-width: 768px', '.box');
    const decl = (prop) => box.nodes.find((n) => n.prop === prop)?.value ?? '';

    // The shell (`.centre`) already ends in clearance + 12px of padding.
    expect(decl('padding')).not.toContain('bottom-nav-clearance');
    expect(decl('padding-bottom')).toBe('');
    // So the card fills the screen LESS that reservation: card + shell padding = one screen.
    expect(decl('min-height')).toContain('--bottom-nav-clearance');
    expect(decl('min-height')).toContain('12px');
  });

  it('the shell really does reserve it (the assumption the card relies on)', async () => {
    const centre = await ruleIn(read('styles/global.css'), 'max-width: 768px', '.centre');
    const paddingBottom = centre.nodes.find((n) => n.prop === 'padding-bottom').value;
    expect(paddingBottom).toContain('--bottom-nav-clearance');
    expect(paddingBottom).toContain('12px');
  });
});

describe('the Messages search field', () => {
  it('has a visible thin border that keeps its size when focused', async () => {
    const css = read('features/messages/shared/components/sidebar/ConversationList.module.css');
    const root = postcss.parse(css);
    let base; let focus;
    root.walkRules('.msgConvSearch', (r) => { base = base || r; });
    root.walkRules('.msgConvSearch:focus-within', (r) => { focus = focus || r; });
    const border = base.nodes.find((n) => n.prop === 'border').value;

    expect(border).toMatch(/^1px solid var\(--color-border\)$/);
    // Focus recolours the same 1px edge; it never swaps to another width.
    expect(focus.nodes.some((n) => n.prop === 'border')).toBe(false);
    expect(focus.nodes.find((n) => n.prop === 'border-color')).toBeTruthy();
  });
});
