/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useSheetDrag } from '../useSheetDrag';

function Sheet({ onClose }) {
  const ref = useSheetDrag(onClose);
  return (
    <div data-testid="backdrop">
      <div ref={ref} data-testid="sheet">
        <div data-sheet-handle data-testid="handle" />
        <div data-testid="body">content</div>
      </div>
    </div>
  );
}

let phone = true;

function touch(el, type, y, t) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientY: y }] });
  Object.defineProperty(e, 'timeStamp', { value: t });
  el.dispatchEvent(e);
  return e;
}

function drag(el, from, to, ms) {
  touch(el, 'touchstart', from, 0);
  const steps = 5;
  let last;
  for (let i = 1; i <= steps; i++) {
    last = touch(el, 'touchmove', from + ((to - from) * i) / steps, (ms * i) / steps);
  }
  touch(el, 'touchend', to, ms);
  return last;
}

beforeEach(() => {
  phone = true;
  vi.useFakeTimers();
  window.matchMedia = (q) => ({
    matches: q.includes('reduced-motion') ? false : phone,
    addEventListener() {},
    removeEventListener() {},
  });
  Element.prototype.getBoundingClientRect = () => ({ height: 400 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useSheetDrag', () => {
  it('closes after a drag past a quarter of the sheet', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Sheet onClose={onClose} />);
    const move = drag(getByTestId('handle'), 100, 250, 600);
    expect(move.defaultPrevented).toBe(true);
    act(() => vi.runAllTimers());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a short fast flick', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Sheet onClose={onClose} />);
    drag(getByTestId('body'), 100, 160, 50);
    act(() => vi.runAllTimers());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('springs back after a short slow drag', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Sheet onClose={onClose} />);
    drag(getByTestId('handle'), 100, 150, 800);
    act(() => vi.runAllTimers());
    expect(onClose).not.toHaveBeenCalled();
    expect(getByTestId('sheet').style.transform).toBe('');
  });

  it('leaves an upward swipe to the browser', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Sheet onClose={onClose} />);
    const move = drag(getByTestId('body'), 300, 100, 300);
    expect(move.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close while the content under the finger is scrolled', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Sheet onClose={onClose} />);
    const body = getByTestId('body');
    Object.defineProperty(body, 'scrollHeight', { value: 800 });
    Object.defineProperty(body, 'clientHeight', { value: 200 });
    body.scrollTop = 50;
    drag(body, 100, 300, 300);
    act(() => vi.runAllTimers());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does nothing outside the phone breakpoint', () => {
    phone = false;
    const onClose = vi.fn();
    const { getByTestId } = render(<Sheet onClose={onClose} />);
    drag(getByTestId('handle'), 100, 350, 300);
    act(() => vi.runAllTimers());
    expect(onClose).not.toHaveBeenCalled();
  });
});
