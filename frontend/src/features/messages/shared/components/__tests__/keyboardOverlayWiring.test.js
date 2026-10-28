import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The keyboard-overlay contract for Messages and the post view's reply bar.
 *
 * In the Android app the keyboard overlays the page (the WebView keeps its
 * height), so a bottom-docked composer has to lift itself by `--kb-inset`.
 * iOS and the website already make room some other way, and lifting there too
 * would do it twice — so every lift here is gated on a marker that only the
 * Android app renders. jsdom has no layout and no keyboard, so these pin the
 * wiring rather than the pixels.
 */
const read = (p) => readFileSync(resolve(p), 'utf8');
const squash = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');


describe('Messages chat with an overlaying keyboard', () => {
  const global = squash(read('src/styles/global.css'));

  it('still shrinks the open chat by --kb-inset where the keyboard is not panned (iOS, website)', () => {
    expect(global).toContain(
      '.centre--messages.chat-is-open { height: calc(100dvh - var(--status-bar-inset, 0px) - var(--kb-inset, 0px)) !important;',
    );
  });

  it('keeps the inbox formula a max() of the nav clearance and the keyboard, never a sum', () => {
    expect(global).toContain(
      'max(0px, calc(var(--bottom-nav-clearance) - var(--kb-layout-shift, 0px)), var(--kb-inset, 0px))',
    );
  });

  it('does not shrink a panning chat at all, so the composer is not lifted twice', () => {
    const rule = global.match(/\.centre--messages\.chat-is-open\.chat-pans-keyboard \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).not.toMatch(/kb-inset/);
    expect(rule[1]).toContain('height: calc(100dvh - var(--status-bar-inset, 0px)) !important');
  });

  it('lifts by --kb-inset minus the navigation bar the composer already pads for (--kb-inset includes the bar)', () => {
    expect(global).toContain('.centre--messages.chat-pans-keyboard { --chat-kb-lift: max(0px, calc(var(--kb-inset, 0px) - env(safe-area-inset-bottom, 0px))); }');
  });

  it('reserves the keyboard (navigation bar area included) under the Android inbox, against the nav clearance', () => {
    expect(global).toContain(
      '.centre--messages.chat-pans-keyboard:not(.chat-is-open) { height: calc(100dvh - var(--status-bar-inset, 0px) - max(var(--bottom-nav-clearance), var(--kb-inset, 0px))) !important;',
    );
  });

  it('pans only where MessagesRoute marks it, which is the Android app', () => {
    const route = read('src/features/messages/pages/MessagesRoute.jsx');
    expect(route).toMatch(/KEYBOARD_OVERLAYS_PAGE \? 'chat-pans-keyboard' : ''/);
  });

  it('marks the Messages composer as a keyboard dock, so the focus pass does not scroll for it', () => {
    expect(read('src/features/messages/shared/components/ChatAreaLayout.jsx')).toMatch(/keyboardDock=\{KEYBOARD_OVERLAYS_PAGE\}/);
    const input = read('src/features/messages/shared/components/ChatInputArea.jsx');
    expect(input).toMatch(/data-keyboard-dock=\{keyboardDock \? '' : undefined\}/);
    // Focusing the docked composer never scrolls anything itself.
    expect(input).not.toMatch(/\.focus\(\)/);
  });

  it('gives the details pages (Edit group) scroll room up to the keyboard\'s top', () => {
    const css = squash(read('src/features/messages/shared/components/details/ChatDetailsPanel.module.css'));
    expect(css).toContain(
      ':global(html[data-keyboard-open] .chat-pans-keyboard) .scrollBody { padding-bottom: calc(1rem + max(env(safe-area-inset-bottom, 0px), var(--kb-inset, 0px))); }',
    );
  });

  it('slides the thread and the composer by the same compositor transform, over the keyboard\'s animation', () => {
    const transform = 'transform: translate3d(0, calc(-1 * var(--chat-kb-lift, 0px)), 0);';
    const transition = 'transition: transform var(--kb-duration, 0ms) var(--kb-easing, ease-out) var(--kb-delay, 0ms);';
    const layout = squash(read('src/features/messages/shared/components/ChatAreaLayout.module.css'));
    const input = squash(read('src/features/messages/shared/components/ChatInputAreaStyles.module.css'));
    for (const [css, cls] of [[layout, 'chatBody'], [input, 'msgChatInputWrap']]) {
      expect(css).toContain(`:global(.chat-pans-keyboard) .${cls} { ${transition} }`);
      // Only while the keyboard is open: at rest a transform would re-anchor
      // anything position: fixed inside it.
      expect(css).toContain(`:global(html[data-keyboard-open] .chat-pans-keyboard) .${cls} { ${transform} }`);
    }
  });

  it('keeps the composer\'s navigation-bar padding while panning instead of dropping it twice', () => {
    const input = squash(read('src/features/messages/shared/components/ChatInputAreaStyles.module.css'));
    expect(input).toContain(':global(html[data-keyboard-open]) .msgChatInputWrap { padding-bottom: 0.6rem; }');
    expect(input).toContain(
      ':global(html[data-keyboard-open] .chat-pans-keyboard) .msgChatInputWrap { padding-bottom: calc(0.6rem + env(safe-area-inset-bottom, 0px)); }',
    );
  });

  it('resets per conversation BEFORE the initial scroll, so a cached chat keeps following the keyboard', () => {
    // React runs plain effects after layout effects. As a plain effect, the
    // reset undid the initial scroll of a chat that opened from cache, and the
    // keyboard observer then bailed out on `hasScrolledInitialRef` until the
    // next message: the newest messages went behind the keyboard.
    const src = read('src/features/messages/shared/components/ChatMessageList.jsx');
    const reset = src.indexOf('useLayoutEffect(() => {\n    hasScrolledInitialRef.current = false;');
    const initialScroll = src.indexOf('// ── SCENARIO 1: Initial load for this conversation');
    expect(reset).toBeGreaterThan(-1);
    expect(initialScroll).toBeGreaterThan(reset);
    expect(src).not.toMatch(/useEffect\(\(\) => \{\n {4}hasScrolledInitialRef\.current = false;/);
  });

  it('gives the thread the panned height back at its top, with scroll anchoring off for the observer', () => {
    const list = squash(read('src/features/messages/shared/components/ChatMessageList.module.css'));
    expect(list).toContain(':global(.chat-pans-keyboard) .msgChatBody { overflow-anchor: none; }');
    expect(list).toContain(
      ':global(html[data-keyboard-open] .chat-pans-keyboard) .msgChatBody { padding-top: calc(0.75rem + var(--chat-kb-lift, 0px)); }',
    );
    // The re-pin is the list's ResizeObserver on its own (content) box.
    expect(read('src/features/messages/shared/components/ChatMessageList.jsx')).toMatch(/observer\.observe\(container\);/);
  });

  it('stands the invite sheet on the keyboard: the share sheet\'s frame, which the shared slide moves', () => {
    // A fixed scrim padded by --kb-inset and a sheet capped above it is what
    // useKeyboardInset finds and slides with the keyboard (keyboardSheetRise).
    const base = 'src/features/messages/shared/components/modals/';
    expect(read(`${base}InviteModal.jsx`)).toMatch(/from '@shared\/components\/share\/ShareSheet\.module\.css'/);
    const css = squash(read('src/shared/components/share/ShareSheet.module.css'));
    expect(css).toMatch(/\.backdrop \{ position: fixed; inset: 0;[^}]*padding-bottom: var\(--kb-inset, 0px\); \}/);
    expect(css).toContain('height: min(78dvh, calc(100dvh - var(--kb-inset, 0px)');
  });

  it('lets the keyboard slide over the new-message sheet without re-laying it out, Android only', () => {
    const base = 'src/features/messages/shared/components/modals/';
    const jsx = read(`${base}NewMessageModal.jsx`);
    expect(jsx).toMatch(/data-keyboard-overlay=\{KEYBOARD_OVERLAYS_PAGE \? '' : undefined\}/);
    expect(jsx).toMatch(/data-keyboard-dock=\{KEYBOARD_OVERLAYS_PAGE \? '' : undefined\}/);
    const css = squash(read(`${base}NewMessageModal.module.css`));
    // The sheet itself never moves or resizes for the keyboard.
    expect(css).not.toMatch(/\.overlay\[data-keyboard-overlay\] \{ padding-bottom/);
    expect(css).toContain(':global(html[data-keyboard-open]) .overlay[data-keyboard-overlay] .scroller { padding-bottom: var(--kb-inset, 0px); }');
    expect(css).toContain('translate: 0 calc(-1 * var(--kb-inset, 0px));');
  });
});

describe('post view reply bar with an overlaying keyboard', () => {
  it('rises by --kb-inset minus the navigation bar it pads for, over the keyboard\'s animation, Android only', () => {
    const css = squash(read('src/features/feed/components/post/ReplyDock.module.css'));
    expect(css).toContain('.dock[data-keyboard-overlay] { transition: transform var(--kb-duration, 0ms) var(--kb-easing, ease-out) var(--kb-delay, 0ms); }');
    expect(css).toContain(
      ':global(html[data-keyboard-open]) .dock[data-keyboard-overlay] { transform: translate3d(0, calc(-1 * max(0px, calc(var(--kb-inset, 0px) - env(safe-area-inset-bottom, 0px)))), 0); }',
    );
    const jsx = read('src/features/feed/components/post/ReplyDock.jsx');
    expect(jsx).toMatch(/data-keyboard-overlay=\{!inline && KEYBOARD_OVERLAYS_PAGE \? '' : undefined\}/);
    expect(jsx).toMatch(/data-keyboard-dock=\{inline \? undefined : ''\}/);
    // Putting the caret in the bar must not scroll the post under it.
    expect(read('src/features/feed/components/post/PostView.jsx')).toMatch(/composerRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  });

  it('keeps room under the last comment up to the keyboard\'s top', () => {
    const css = squash(read('src/features/feed/components/post/PostView.module.css'));
    expect(css).toContain(
      ':global(html[data-keyboard-open]) .postViewContainer[data-keyboard-overlay] { padding-bottom: calc(64px + max(env(safe-area-inset-bottom, 0px), var(--navigation-bar-inset, 0px), var(--kb-inset, 0px))); }',
    );
  });
});
