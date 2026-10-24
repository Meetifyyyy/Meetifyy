import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The thread's vertical rhythm is owned by one place: `gap` on `.msgChatBody`.
 *
 * Every row used to carry a margin of its own, and the rows disagreed - a text
 * bubble 4.8px from its neighbour, a card or media row 7-15px depending on
 * what it sat next to, a date or system row 16px above and 10px below - because
 * a flex column does not collapse margins, so each one just stacked on the
 * last. jsdom has no layout, so this pins the wiring that makes the spacing
 * uniform rather than the pixels (the pixels were measured in a browser).
 */
const read = (p) => readFileSync(resolve(p), 'utf8');
const normalise = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();

/** The declarations of the rule whose selector list is exactly `selector`. */
function rule(css, selector) {
  const wanted = normalise(selector).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalise(css).match(new RegExp(`(?:^|\\}) ?${wanted} \\{([^}]*)\\}`));
  return match ? match[1].trim() : null;
}
const count = (css, selector) => {
  const wanted = normalise(selector).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...normalise(css).matchAll(new RegExp(`(?:^|\\}) ?${wanted} \\{`, 'g'))].length;
};

const VERTICAL_MARGIN = /^margin(-top|-bottom|-block(-start|-end)?)?\s*:/;
// `margin: 0` is the absence of a margin; only a real one adds distance.
const hasVerticalMargin = (declarations) =>
  declarations != null &&
  declarations
    .split(';')
    .map((d) => d.trim())
    .filter((d) => VERTICAL_MARGIN.test(d))
    .some((d) => !/:\s*0(px|rem)?(\s+0(px|rem)?)*$/.test(d));

describe('thread spacing', () => {
  const list = read('src/features/messages/shared/components/ChatMessageList.module.css');
  const body = rule(list, '.msgChatBody');
  const token = (name) => parseFloat(body.match(new RegExp(`${name}:\\s*([\\d.]+)rem;`))[1]);

  it('declares the spacing tokens, and spaces rows with `gap`, on the thread', () => {
    expect(body).not.toBeNull();
    for (const name of ['--msg-gap', '--msg-gap-run', '--msg-gap-section', '--msg-gap-attach', '--msg-gap-stack']) {
      expect(body, name).toMatch(new RegExp(`${name}:\\s*[\\d.]+rem;`));
    }
    expect(body).toContain('gap: var(--msg-gap);');
  });

  it('orders them: inside a message < within a run < between authors < around a notice', () => {
    expect(token('--msg-gap-attach')).toBeLessThan(token('--msg-gap-run'));
    expect(token('--msg-gap-run')).toBeLessThan(token('--msg-gap-stack'));
    expect(token('--msg-gap-stack')).toBeLessThan(token('--msg-gap'));
    expect(token('--msg-gap')).toBeLessThan(token('--msg-gap-section'));
  });

  it('gives no row a vertical margin of its own, whatever it contains', () => {
    // Every kind of message row: bubbles (text, reply, unsent, typing), and the
    // card/media/voice wrapper that carries images, video, voice notes, shared
    // posts / profiles / communities / activities and group invites.
    for (const selector of ['.msgBubbleContainer', '.msgImageCardContainer, .msgAudioCardContainer']) {
      const declarations = rule(list, selector);
      expect(declarations, selector).not.toBeNull();
      expect(hasVerticalMargin(declarations), `${selector} must not set a margin`).toBe(false);
    }
  });

  it('closes a same-author row up by exactly the difference between the two gaps', () => {
    const run = rule(list, ".msgBubbleContainer[data-run='continue']");
    expect(run).toBe('margin-top: calc(var(--msg-gap-run, 0.15rem) - var(--msg-gap, 0.5rem));');
    // The fallbacks must be the tokens' own values, or outside the thread they
    // would disagree with inside it.
    expect(token('--msg-gap-run')).toBe(0.15);
    expect(token('--msg-gap')).toBe(0.5);
  });

  it('keeps a full gap under a row that ends in a status line', () => {
    expect(
      rule(list, ".msgBubbleContainer[data-status-line] + .msgBubbleContainer[data-run='continue']"),
    ).toBe('margin-top: 0;');
  });

  it('spaces date separators and system notices through one shared rule, so they cannot disagree', () => {
    expect(rule(list, '.msgDateSeparator, .systemMessageContainer')).toContain(
      'margin-block: calc(var(--msg-gap-section, 1rem) - var(--msg-gap, 0.5rem));',
    );
    // Neither sets a margin in its own rule (that is how 16/10 happened), and
    // the early duplicate of the notice rule (margin 0.5rem 0) is gone.
    expect(hasVerticalMargin(rule(list, '.msgDateSeparator'))).toBe(false);
    expect(count(list, '.systemMessageContainer')).toBe(1);
    expect(hasVerticalMargin(rule(list, '.systemMessageContainer'))).toBe(false);
  });

  it('keeps consecutive section rows one row-gap apart instead of stacking their margins', () => {
    const stacked = rule(
      list,
      '.msgDateSeparator + .msgDateSeparator, .msgDateSeparator + .systemMessageContainer, .systemMessageContainer + .msgDateSeparator, .systemMessageContainer + .systemMessageContainer',
    );
    expect(stacked).toBe('margin-top: calc(var(--msg-gap, 0.5rem) - var(--msg-gap-section, 1rem));');
  });

  it('leaves no outer margin on the shared cards, which sit inside the row', () => {
    const community = rule(read('src/features/messages/shared/previews/SharedCommunityPreview.module.css'), '.card');
    const activity = rule(read('src/features/messages/shared/previews/SharedActivityPreview.module.css'), '.activityShareCardNew');
    expect(hasVerticalMargin(community), 'community card').toBe(false);
    expect(hasVerticalMargin(activity), 'activity card').toBe(false);
  });

  it('ties the parts of a message to the inner token, not to a pixel value of their own', () => {
    expect(rule(list, '.msgSenderName')).toContain('margin-bottom: var(--msg-gap-attach, 0.1rem);');
    expect(rule(list, '.msgStatusLabel')).toContain('margin-top: var(--msg-gap-attach, 0.1rem);');
    expect(rule(list, '.msgImageCardContainer, .msgAudioCardContainer')).toContain('gap: var(--msg-gap-attach, 0.1rem);');
    expect(
      rule(read('src/features/messages/shared/components/reply/PostReplyPreview/PostReplyPreview.module.css'), '.replyContainer'),
    ).toContain('margin-bottom: var(--msg-gap-stack, 0.25rem);');
    expect(token('--msg-gap-attach')).toBe(0.1);
    expect(token('--msg-gap-stack')).toBe(0.25);
  });

  it('does not keep a second copy of thread spacing in the composer stylesheet', () => {
    const composer = read('src/features/messages/shared/components/ChatInputAreaStyles.module.css');
    for (const cls of ['.systemMessageContainer', '.msgAudioCardContainer', '.msgChatBody']) {
      expect(count(composer, cls), cls).toBe(0);
    }
  });
});

describe('typing indicator', () => {
  const source = read('src/features/messages/shared/components/ChatMessageList.jsx');

  it('is built like a text message, so it is as tall as one, instead of overriding the bubble inline', () => {
    const typing = source.slice(source.indexOf('{/* ── Typing indicator ── */}'), source.indexOf('{/* ── Empty state ── */}'));
    expect(typing).toContain('styles.msgTextTimeWrap');
    expect(typing).toContain('styles.msgTextContent');
    expect(typing).toContain('styles.msgText}');
    expect(typing).toContain('styles.typingBubbleInline');
    // The override that made it 27.8px against 42px for a one-line message.
    expect(typing).not.toMatch(/style=\{\{[^}]*padding/);
  });
});
