import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Instant Match gets the keyboard the same way Messages does (commit d65d4799):
 * docks lifted by a transform on the keyboard's own curve, nothing resized per
 * frame. Real keyboard motion needs the installed app; this pins the wiring.
 */
const read = (rel) => readFileSync(resolve('src/features/instant-match', rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');

const chatCss = squash(read('styles/instant-match-chat.css'));
const sheetCss = squash(read('styles/instant-match-sheet.css'));
const surface = read('components/chat/InstantMatchChatSurface.jsx');
const sheet = read('components/InstantMatchSheet.jsx');

describe('Instant Match chat keyboard', () => {
  it('opts in to the shared Messages classes only where the keyboard overlays the page', () => {
    expect(surface).toMatch(/KEYBOARD_OVERLAYS_PAGE \? ' chat-pans-keyboard' : ''/);
    expect(surface).toMatch(/keyboardDock=\{KEYBOARD_OVERLAYS_PAGE\}/);
  });

  it('keeps the old root padding where the browser handles the keyboard, drops it in the app', () => {
    expect(chatCss).toContain('padding-bottom: max(env(safe-area-inset-bottom), var(--kb-inset, 0px));');
    expect(chatCss).toMatch(/\.im-chat-root\.chat-pans-keyboard \{ --chat-kb-lift: max\(0px, calc\(var\(--kb-inset, 0px\) - env\(safe-area-inset-bottom, 0px\)\)\); padding-bottom: env\(safe-area-inset-bottom, 0px\); \}/);
  });

  it('lifts the thread by a transform on the keyboard curve, and never lifts the composer twice', () => {
    expect(chatCss).toMatch(/\.im-chat-root\.chat-pans-keyboard \.im-chat-body[^{]*\{ transition: transform var\(--kb-duration, 0ms\) var\(--kb-easing, ease-out\) var\(--kb-delay, 0ms\); \}/);
    expect(chatCss).toMatch(/html\[data-keyboard-open\] \.im-chat-root\.chat-pans-keyboard \.im-chat-body[^{]*\{ transform: translate3d\(0, calc\(-1 \* var\(--chat-kb-lift, 0px\)\), 0\); \}/);
    // The composer lifts itself (.msgChatInputWrap); lifting its wrapper too would double it.
    expect(chatCss).not.toMatch(/chat-pans-keyboard \.im-chat-foot/);
  });

  it('keeps the header and the reason strip opaque above the sliding thread', () => {
    expect(chatCss).toMatch(/\.im-chat-root\.chat-pans-keyboard \.im-chat-head, \.im-chat-root\.chat-pans-keyboard \.im-chat-reason \{ position: relative; z-index: 2; \}/);
  });

  it('animates no layout property for the keyboard', () => {
    const block = chatCss.slice(chatCss.indexOf('Keyboard, Android app'));
    expect(block).not.toMatch(/transition:[^;]*(height|padding|margin|top|bottom)/);
  });

  it('respects reduced motion', () => {
    expect(chatCss).toMatch(/prefers-reduced-motion: reduce\) \{ \.im-chat-root\.chat-pans-keyboard \.im-chat-body/);
  });
});

describe('Instant Match sheet keyboard', () => {
  it('marks the overlay and the sheet only where the keyboard overlays the page', () => {
    expect(sheet).toMatch(/KEYBOARD_OVERLAYS_PAGE \? ' im-kb-overlay' : ''/);
    expect(sheet).toMatch(/data-keyboard-dock=\{KEYBOARD_OVERLAYS_PAGE \? '' : undefined\}/);
  });

  it('lifts the sheet by translate on the keyboard curve and snaps its height cap', () => {
    expect(sheetCss).toContain('.im-sheet-overlay.im-kb-overlay .im-sheet { max-height: min(88dvh, 780px, calc(100dvh - var(--im-kb-lift) - var(--status-bar-inset, 0px) - 1rem)); transition: translate var(--kb-duration, 0ms) var(--kb-easing, ease-out) var(--kb-delay, 0ms); }');
    expect(sheetCss).toContain('html[data-keyboard-open] .im-sheet-overlay.im-kb-overlay .im-sheet { translate: 0 calc(-1 * var(--im-kb-lift)); }');
    expect(sheetCss).toContain('.im-sheet-overlay.im-kb-overlay { --im-kb-lift: max(0px, calc(var(--kb-inset, 0px) - env(safe-area-inset-bottom, 0px))); padding-bottom: 0; }');
  });

  it('keeps the browser path (overlay padding) for iOS and the website', () => {
    expect(sheetCss).toContain('padding-bottom: var(--kb-inset, 0px);');
  });
});
