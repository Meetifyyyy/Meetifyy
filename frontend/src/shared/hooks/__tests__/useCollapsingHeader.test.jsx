/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCollapsingHeader } from '../useCollapsingHeader';

describe('useCollapsingHeader cover transition', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.scrollY;
    document.documentElement.removeAttribute('data-collapsing-header');
    document.documentElement.removeAttribute('data-status-bar-icons');
    document.documentElement.style.removeProperty('--profile-collapse');
    document.documentElement.style.removeProperty('--profile-cover-height');
  });

  /*
   * A card: the cover (200px), then the info block with the avatar hanging
   * 30px over the cover's bottom edge (top 170, 96px tall, bottom at 266).
   * Header 80px. The cover's box pins at 120 (200 - 80); its picture pans a
   * further 66px, until the avatar's bottom (266) reaches the header's bottom:
   * the pin is at 186.
   */
  const buildCard = ({ coverHeight = () => 200 } = {}) => {
    const card = document.createElement('div');
    const cover = document.createElement('div');
    const info = document.createElement('div');
    const avatar = document.createElement('div');
    avatar.setAttribute('data-cover-avatar', '');
    avatar.setAttribute('data-exit-track', 'avatar');
    avatar.setAttribute('data-exit-through', '');
    Object.defineProperty(cover, 'offsetHeight', { get: coverHeight });
    Object.defineProperty(info, 'offsetTop', { get: () => coverHeight() });
    Object.defineProperties(avatar, { offsetTop: { value: 170 }, offsetHeight: { value: 96 } });
    info.appendChild(avatar);
    card.append(cover, info);
    document.body.appendChild(card);
    return { card, cover, avatar };
  };

  it('scrolls the cover with the page, blurs it, and pins it when the avatar bottom reaches the header bottom', () => {
    let scrollY = 0;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });

    const header = document.createElement('div');
    Object.defineProperty(header, 'offsetHeight', { value: 80 });
    const { card, cover, avatar } = buildCard();
    const blurLayer = document.createElement('div');
    blurLayer.setAttribute('data-cover-blur', '');
    cover.appendChild(blurLayer);

    const { unmount } = renderHook(() => useCollapsingHeader({
      enabled: true,
      headerRef: { current: header },
      coverRef: { current: cover },
      coverBackground: true,
    }));
    const scrollTo = (y) => act(() => {
      scrollY = y;
      window.dispatchEvent(new Event('scroll'));
    });

    expect(document.documentElement.style.getPropertyValue('--profile-cover-height')).toBe('200px');
    expect(cover.style.getPropertyValue('--cover-pin-top')).toBe('-120px');
    expect(cover.style.getPropertyValue('--cover-extend')).toBe('66px');
    expect(cover.style.getPropertyValue('--cover-pan')).toBe('0');
    expect(blurLayer.style.getPropertyValue('--cover-blur')).toBe('0.000');

    // Before the box pins: the page moves the cover (sticky), no pan yet.
    scrollTo(93);
    expect(cover.style.getPropertyValue('--cover-pan')).toBe('0');
    expect(blurLayer.style.getPropertyValue('--cover-blur')).toBe('0.500');

    // Box pinned, the picture keeps moving 1:1 inside it.
    scrollTo(150);
    expect(cover.style.getPropertyValue('--cover-pan')).toBe('30');
    expect(avatar.style.getPropertyValue('--exit')).toBe('0.625');

    // Avatar bottom on the header bottom: pinned, fully blurred, avatar gone.
    scrollTo(186);
    expect(cover.style.getPropertyValue('--cover-pan')).toBe('66');
    expect(blurLayer.style.getPropertyValue('--cover-blur')).toBe('1.000');
    expect(avatar.style.getPropertyValue('--exit')).toBe('1.000');

    scrollTo(900);
    expect(cover.style.getPropertyValue('--cover-pan')).toBe('66');

    // And back.
    scrollTo(30);
    expect(cover.style.getPropertyValue('--cover-pan')).toBe('0');
    expect(avatar.style.getPropertyValue('--exit')).toBe('0.000');

    unmount();
    expect(document.documentElement.hasAttribute('data-collapsing-header')).toBe(false);
    expect(cover.style.getPropertyValue('--cover-pin-top')).toBe('');
    card.remove();
  });

  it('re-measures when the cover resizes without a window resize (status-bar inset)', () => {
    let nextFrame = null;
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const observers = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 });

    let coverHeight = 120;
    const header = document.createElement('div');
    Object.defineProperty(header, 'offsetHeight', { value: 56 });
    const { card, cover } = buildCard({ coverHeight: () => coverHeight });

    renderHook(() => useCollapsingHeader({
      enabled: true,
      headerRef: { current: header },
      coverRef: { current: cover },
      coverBackground: true,
    }));
    expect(document.documentElement.style.getPropertyValue('--profile-cover-height')).toBe('120px');
    expect(cover.style.getPropertyValue('--cover-pin-top')).toBe('-64px');

    act(() => {
      coverHeight = 152; // the inset arrived and the cover grew
      observers.forEach((o) => o.callback([]));
      const callback = nextFrame;
      nextFrame = null;
      callback?.();
    });
    expect(document.documentElement.style.getPropertyValue('--profile-cover-height')).toBe('152px');
    expect(header.style.getPropertyValue('--cover-h')).toBe('152');
    expect(cover.style.getPropertyValue('--cover-pin-top')).toBe('-96px');
    card.remove();
  });
});

describe('useCollapsingHeader exit tracking', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.scrollY;
    document.documentElement.removeAttribute('data-collapsing-header');
    document.documentElement.removeAttribute('data-status-bar-icons');
    document.documentElement.style.removeProperty('--profile-cover-height');
    document.documentElement.style.removeProperty('--profile-cover-h');
  });

  const place = (el, top, height) => {
    Object.defineProperties(el, {
      offsetTop: { value: top },
      offsetHeight: { value: height },
      offsetParent: { value: null },
    });
  };

  // 0 while an element is well clear of the header, 1 once its top edge has
  // reached the header's bottom - it must be invisible by then so the header's
  // opaque edge never slices through it. It is plain scroll-position maths
  // written onto the elements that read it, because scroll-driven animations
  // stall a fast flick in the installed app's WebView.
  it('fades tracked elements out before they reach the header, and never writes onto <html>', () => {
    let scrollY = 0;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });

    const card = document.createElement('div');
    const cover = document.createElement('div');
    const avatar = document.createElement('div');
    const name = document.createElement('h1');
    const edit = document.createElement('button');
    const pageBlur = document.createElement('div');
    avatar.setAttribute('data-exit-track', 'avatar');
    // Pinned on the header's bottom line by the page, fading over 100px after.
    avatar.setAttribute('data-exit-sticky', '');
    avatar.setAttribute('data-exit-after', '100');
    avatar.setAttribute('data-exit-inert', '');
    avatar.style.marginTop = '300px';
    name.setAttribute('data-exit-track', 'name');
    edit.setAttribute('data-exit-track', 'edit-cover');
    edit.setAttribute('data-exit-inert', '');
    edit.setAttribute('data-exit-lead', '20');
    pageBlur.setAttribute('data-cover-blur', '');
    card.append(cover, avatar, name, edit, pageBlur);
    const header = document.createElement('div');
    place(header, 0, 80);
    // A sticky element's offsetTop moves while it is stuck, so its place is
    // taken from its parent and its margin (here 300px): the top edge meets
    // the header's bottom at scrollY 220.
    place(avatar, 9999, 100);
    place(name, 450, 50); // ... at 370
    place(edit, 130, 34); // ... at 50, with a lead of 20
    cover.getBoundingClientRect = () => ({ height: 200 });

    renderHook(() => useCollapsingHeader({
      enabled: true,
      headerRef: { current: header },
      coverRef: { current: cover },
      coverBackground: true,
    }));

    const scrollTo = (y) => act(() => {
      scrollY = y;
      window.dispatchEvent(new Event('scroll'));
    });

    // The avatar starts at 220 (its top edge touching the header) and fades
    // over the 100px after, staying pinned there by the page.
    expect(avatar.style.getPropertyValue('--exit')).toBe('0.000');
    scrollTo(219);
    expect(avatar.style.getPropertyValue('--exit')).toBe('0.000');
    scrollTo(270);
    expect(avatar.style.getPropertyValue('--exit')).toBe('0.500');
    expect(avatar.style.pointerEvents).toBe('none');
    scrollTo(320);
    expect(avatar.style.getPropertyValue('--exit')).toBe('1.000');
    scrollTo(900);
    expect(avatar.style.getPropertyValue('--exit')).toBe('1.000');
    scrollTo(245); // and back
    expect(avatar.style.getPropertyValue('--exit')).toBe('0.250');
    expect(avatar.style.pointerEvents).toBe('');

    // The name fades from 330 to 370; the header's title follows it.
    scrollTo(350);
    expect(name.style.getPropertyValue('--exit')).toBe('0.500');
    expect(header.style.getPropertyValue('--exit-name')).toBe('0.500');

    // An element near the header at rest has a short lead, and is inert once
    // mostly gone.
    scrollTo(0);
    expect(edit.style.pointerEvents).toBe('');
    scrollTo(45); // fades from 30 to 50
    expect(edit.style.getPropertyValue('--exit')).toBe('0.750');
    expect(edit.style.pointerEvents).toBe('none');
    scrollTo(35);
    expect(edit.style.pointerEvents).toBe('');

    // The page's own cover is the header, so only its blur layer is written.
    scrollTo(60);
    expect(pageBlur.style.getPropertyValue('--cover-blur')).not.toBe('');
    expect(header.style.getPropertyValue('--cover-blur')).toBe('');
    expect(card.style.getPropertyValue('--cover-blur')).toBe('');
    expect(card.style.getPropertyValue('--exit')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--exit')).toBe('');
  });

  it('attaches a scroll listener (no scroll-driven animations to rely on)', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const add = vi.spyOn(window, 'addEventListener');
    const header = document.createElement('div');
    const cover = document.createElement('div');
    cover.getBoundingClientRect = () => ({ height: 200 });
    renderHook(() => useCollapsingHeader({
      enabled: true,
      headerRef: { current: header },
      coverRef: { current: cover },
      coverBackground: true,
    }));
    expect(add.mock.calls.some(([type, , options]) => type === 'scroll' && options?.passive === true)).toBe(true);
  });
});

describe('shared cover attributes', () => {
  it('stay while any cover page is mounted, whatever order they leave in', async () => {
    // Earlier tests leave their hooks mounted; unmount them so the count starts at zero.
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    const root = document.documentElement;
    root.setAttribute('data-status-bar-icons', 'dark');
    const make = () => {
      const header = document.createElement('div');
      const cover = document.createElement('div');
      document.body.append(header, cover);
      return renderHook(() => useCollapsingHeader({ enabled: true, headerRef: { current: header }, coverRef: { current: cover } }));
    };
    const a = make();
    const b = make(); // the next cover page mounts before the first has left
    a.unmount();
    expect(root.hasAttribute('data-collapsing-header')).toBe(true);
    b.unmount();
    expect(root.hasAttribute('data-collapsing-header')).toBe(false);
    expect(root.getAttribute('data-status-bar-icons')).toBe('dark');
    root.removeAttribute('data-status-bar-icons');
  });
});
