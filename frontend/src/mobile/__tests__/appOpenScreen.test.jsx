/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The installed app's front door: three slides you swipe, two doors out.
 *
 * Everything the screen warms up or reaches for natively is stubbed: the auth
 * chunks it preloads, the system bars, and the signup-resume store.
 */
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));
vi.mock('../../features/auth/routes/authRoutes', () => ({
  preloadAuthScreens: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../features/auth/signupResume', () => ({ takeSignupResume: () => null }));
vi.mock('../../features/auth/context/SignupContext', () => ({ seedSignupDraft: vi.fn() }));
vi.mock('../../shared/hooks/useSystemBars', () => ({ useSystemBars: vi.fn() }));

const { default: AppOpenScreen } = await import('../AppOpenScreen');

// A MouseEvent carries the coordinates the screen reads. The timestamp is
// settable here because the screen measures flick speed from it, and under
// fake timers a real one would not advance between the events.
window.PointerEvent = class PointerEvent extends MouseEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'touch';
    Object.defineProperty(this, 'timeStamp', { value: init.timeStamp ?? 0 });
  }
};

const mount = () => render(
  <MemoryRouter>
    <AppOpenScreen />
  </MemoryRouter>,
);

const setReducedMotion = (reduce) => {
  window.matchMedia = vi.fn((query) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};

const screenEl = () => document.querySelector('[data-launch-surface]');
const pager = () => document.querySelector('[class*="_pager_"]');
// The slide the motion is heading for (set the moment a gesture or a dot decides it).
const progress = () => screenEl().dataset.target ?? '0';
// Where the track is drawn right now, in slides (0 = first), from its transform.
const trackPos = () => {
  const m = /translate3d\((-?[\d.]+)%/.exec(document.querySelector('[class*="_track_"]').style.transform);
  return m ? -Number(m[1]) / (100 / 3) : NaN;
};
const currentDot = () => document.querySelector('button[aria-current="true"]')?.getAttribute('aria-label');

/** Drag the pager sideways like a thumb: down, a few moves, up. */
const swipe = (fromX, toX, { toY = 300, ms = 400, settle = true } = {}) => {
  const el = pager();
  let t = 1000;
  const fire = (type, x, y) => {
    t += ms / 4;
    fireEvent(el, new window.PointerEvent(type, {
      bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', timeStamp: t,
    }));
  };
  fire('pointerdown', fromX, 300);
  fire('pointermove', fromX + (toX - fromX) * 0.4, (300 + toY) / 2);
  fire('pointermove', fromX + (toX - fromX) * 0.8, toY);
  fire('pointermove', toX, toY);
  fire('pointerup', toX, toY);
  if (settle) act(() => { vi.advanceTimersByTime(1500); }); // let the spring land
};

beforeEach(() => {
  vi.useFakeTimers();
  navigate.mockClear();
  setReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.matchMedia;
});

describe('AppOpenScreen', () => {
  it('names the app for a screen reader and gives each slide its own heading', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, hidden: true }).textContent).toBe('Meetifyy');
    const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toHaveLength(3);
    expect(new Set(headings).size).toBe(3);
    expect(headings[0]).toContain('Find your people');
  });

  it('shows no logo or wordmark', () => {
    mount();
    expect(document.querySelectorAll('img[alt="Meetifyy"]')).toHaveLength(0);
  });

  it('gives every slide its own sentence, photos and tiles', () => {
    mount();
    const panels = [...document.querySelectorAll('section')];
    expect(panels).toHaveLength(3);
    const subs = panels.map((p) => p.querySelector('p').textContent);
    expect(new Set(subs).size).toBe(3);
    const photos = panels.flatMap((p) => [...p.querySelectorAll('img')].map((i) => i.getAttribute('src')));
    expect(photos).toHaveLength(9);
    expect(new Set(photos).size).toBe(9);
    panels.forEach((p) => expect(p.querySelectorAll('li')).toHaveLength(4));
  });

  it('offers both doors', async () => {
    setReducedMotion(true);
    mount();
    fireEvent.click(document.getElementById('open-screen-login'));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(navigate).toHaveBeenCalledWith('/login', { state: { fromOpenScreen: true } });
  });

  it('leaves for signup once, however many times the button is hit', async () => {
    setReducedMotion(true);
    mount();
    const signup = document.getElementById('open-screen-signup');
    fireEvent.click(signup);
    fireEvent.click(signup);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/signup', { state: { fromOpenScreen: true } });
  });

  it('stays on the first slide under reduced motion, however long it waits', () => {
    setReducedMotion(true);
    mount();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(currentDot()).toMatch(/slide 1 of 3/);
  });

  it('turns to the next slide on a swipe left, and back on a swipe right', () => {
    mount();
    swipe(700, 200);
    expect(currentDot()).toMatch(/slide 2 of 3/);
    expect(progress()).toBe('1');
    swipe(700, 200);
    expect(currentDot()).toMatch(/slide 3 of 3/);
    expect(progress()).toBe('2');
    swipe(200, 700);
    expect(currentDot()).toMatch(/slide 2 of 3/);
  });

  it('does not go past either end', () => {
    mount();
    swipe(200, 700);
    expect(currentDot()).toMatch(/slide 1 of 3/);
    expect(progress()).toBe('0');
    swipe(700, 200);
    swipe(700, 200);
    swipe(700, 200);
    expect(currentDot()).toMatch(/slide 3 of 3/);
    expect(progress()).toBe('2');
  });

  it('snaps back when the drag is short and slow', () => {
    mount();
    swipe(500, 450, { ms: 4000 });
    expect(currentDot()).toMatch(/slide 1 of 3/);
    expect(progress()).toBe('0');
  });

  it('turns on a quick flick even when it is short', () => {
    mount();
    swipe(500, 420, { ms: 40 });
    expect(currentDot()).toMatch(/slide 2 of 3/);
  });

  it('leaves a mostly vertical drag alone', () => {
    mount();
    swipe(500, 380, { toY: 700 });
    expect(currentDot()).toMatch(/slide 1 of 3/);
  });

  it('follows the finger while dragging, and springs to a slide once released', () => {
    mount();
    const el = pager();
    const fire = (type, x) => fireEvent(el, new window.PointerEvent(type, {
      bubbles: true, clientX: x, clientY: 300, pointerId: 1, pointerType: 'touch',
    }));
    fire('pointerdown', 600);
    fire('pointermove', 500);
    fire('pointermove', 300);
    // 300px of a 1024px-wide window: partway between slide 1 and slide 2.
    act(() => { vi.advanceTimersByTime(32); }); // the drag is drawn once per frame
    expect(screenEl().dataset.drag).toBe('true');
    // It follows the finger 1:1 from where the drag was recognised (the first
    // move past the touch slop, at x = 500), without jumping by the slop.
    expect(trackPos()).toBeCloseTo(200 / 1024, 3);
    fire('pointerup', 300);
    expect(screenEl().dataset.drag).toBeUndefined();
  });

  it('lands exactly on the slide once the spring settles', () => {
    mount();
    swipe(700, 200);
    expect(trackPos()).toBe(1);
    expect(screenEl().dataset.drag).toBeUndefined();
  });

  it('carries on forward when swiped again before the last swipe has settled', () => {
    mount();
    swipe(700, 200, { settle: false });
    act(() => { vi.advanceTimersByTime(80); }); // part-way to slide 2
    const mid = trackPos();
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(1);
    swipe(700, 450); // a short forward drag from mid-flight
    expect(currentDot()).toMatch(/slide 3 of 3|slide 2 of 3/);
    expect(trackPos()).toBeGreaterThanOrEqual(1);
  });

  it('jumps to a slide when its dot is tapped', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /slide 3 of 3/ }));
    expect(currentDot()).toMatch(/slide 3 of 3/);
    expect(progress()).toBe('2');
  });

  it('hides the slides that are not showing from assistive tech', () => {
    mount();
    const hidden = () => [...document.querySelectorAll('section')].map((s) => s.getAttribute('aria-hidden'));
    expect(hidden()).toEqual([null, 'true', 'true']);
    fireEvent.click(screen.getByRole('button', { name: /slide 2 of 3/ }));
    expect(hidden()).toEqual(['true', null, 'true']);
  });

  describe('auto-advance', () => {
    const wait = (ms) => act(() => { vi.advanceTimersByTime(ms); });
    const setVisibility = (state) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    afterEach(() => { delete document.visibilityState; });

    it('turns to the next slide after about four seconds, with the swipe\'s own spring', () => {
      mount();
      wait(3900);
      expect(currentDot()).toMatch(/slide 1 of 3/);
      wait(200);
      expect(currentDot()).toMatch(/slide 2 of 3/);
      expect(progress()).toBe('1');
      // Mid-flight it is between slides, then it lands exactly.
      wait(1500);
      expect(trackPos()).toBe(1);
    });

    it('keeps going and loops back to the first slide after the last', () => {
      mount();
      wait(4100);
      expect(currentDot()).toMatch(/slide 2 of 3/);
      wait(4000);
      expect(currentDot()).toMatch(/slide 3 of 3/);
      wait(4000);
      expect(currentDot()).toMatch(/slide 1 of 3/);
      wait(1500);
      expect(trackPos()).toBeCloseTo(0, 5);
    });

    it('waits while a finger is down and counts again from the release', () => {
      mount();
      const el = pager();
      const fire = (type, x) => fireEvent(el, new window.PointerEvent(type, {
        bubbles: true, clientX: x, clientY: 300, pointerId: 1, pointerType: 'touch',
      }));
      wait(3000);
      fire('pointerdown', 600);
      wait(20_000);
      expect(currentDot()).toMatch(/slide 1 of 3/);
      fire('pointerup', 600); // a tap: nothing to turn
      wait(3900);
      expect(currentDot()).toMatch(/slide 1 of 3/);
      wait(200);
      expect(currentDot()).toMatch(/slide 2 of 3/);
    });

    it('counts again from a swipe instead of turning right after it', () => {
      mount();
      wait(3500);
      swipe(700, 200, { settle: false }); // to slide 2 at 3.5s
      wait(3900);
      expect(currentDot()).toMatch(/slide 2 of 3/);
      wait(200);
      expect(currentDot()).toMatch(/slide 3 of 3/);
    });

    it('counts again after a dot is tapped', () => {
      mount();
      wait(3500);
      fireEvent.click(screen.getByRole('button', { name: /slide 2 of 3/ }));
      wait(3900);
      expect(currentDot()).toMatch(/slide 2 of 3/);
      wait(200);
      expect(currentDot()).toMatch(/slide 3 of 3/);
    });

    it('does not turn while the page is hidden, and counts afresh when it is back', () => {
      mount();
      wait(2000);
      setVisibility('hidden');
      wait(30_000);
      expect(currentDot()).toMatch(/slide 1 of 3/);
      setVisibility('visible');
      wait(3900);
      expect(currentDot()).toMatch(/slide 1 of 3/);
      wait(200);
      expect(currentDot()).toMatch(/slide 2 of 3/);
    });

    it('stops its timer when the screen goes away', () => {
      const { unmount } = mount();
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
