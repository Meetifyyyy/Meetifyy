/** @vitest-environment jsdom */
import { Profiler } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PullToRefresh from '../PullToRefresh';

/**
 * The pull paints itself onto the DOM: dragging must not re-render React.
 * It used to set React state on every touchmove, several times per frame.
 */
describe('PullToRefresh', () => {
  let frames;
  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const flushFrame = () => act(() => { frames.splice(0).forEach((cb) => cb(0)); });

  const touch = (el, type, y) => {
    const t = { clientY: y, clientX: 10, identifier: 1, target: el };
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { touches: type === 'touchend' ? [] : [t], changedTouches: [t] });
    act(() => { el.dispatchEvent(event); });
  };

  const setup = (onRefresh) => {
    let commits = 0;
    const utils = render(
      <Profiler id="ptr" onRender={() => { commits += 1; }}>
        <PullToRefresh onRefresh={onRefresh} surface="sheet">
          <p data-testid="page">page</p>
        </PullToRefresh>
      </Profiler>,
    );
    const page = utils.getByTestId('page');
    const content = page.parentElement;
    return { page, content, commits: () => commits };
  };

  it('follows the finger without re-rendering React on each move', () => {
    const { page, content, commits } = setup(() => Promise.resolve());
    touch(page, 'touchstart', 100);
    touch(page, 'touchmove', 110); // arms the pull (phase: pulling)
    flushFrame();
    const afterArming = commits();
    for (let y = 112; y < 150; y += 2) touch(page, 'touchmove', y); // many moves, one frame
    flushFrame();
    expect(commits()).toBe(afterArming);
    const moved = Number(content.style.transform.match(/translate3d\(0, ([\d.]+)px/)[1]);
    expect(moved).toBeGreaterThan(20);
    expect(moved).toBeLessThan(49);
  });

  it('keeps the spinner up for the whole refresh, then settles back', async () => {
    let finish;
    const onRefresh = vi.fn(() => new Promise((r) => { finish = r; }));
    const { page, content, commits } = setup(onRefresh);
    touch(page, 'touchstart', 100);
    for (let y = 110; y <= 400; y += 30) touch(page, 'touchmove', y);
    flushFrame();
    touch(page, 'touchend', 400);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(content.style.transform).toBe('translate3d(0, 72px, 0)');
    const spinning = () => document.querySelector('[class*="dialSpinning"]') !== null;
    expect(spinning()).toBe(true);

    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(spinning()).toBe(true); // the refresh is still running
    const before = commits();
    await act(async () => { finish(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(spinning()).toBe(false);
    expect(content.style.transform).toBe('none'); // settled, transform dropped
    expect(commits() - before).toBeLessThanOrEqual(2);
  });

  it('springs back without refreshing when released short of the threshold', async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const { page, content } = setup(onRefresh);
    touch(page, 'touchstart', 100);
    touch(page, 'touchmove', 140);
    flushFrame();
    touch(page, 'touchend', 140);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(content.style.transform).toBe('translate3d(0, 0px, 0)');
    expect(content.style.transition).toContain('transform 0.32s');
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(content.style.transform).toBe('none');
  });
});
