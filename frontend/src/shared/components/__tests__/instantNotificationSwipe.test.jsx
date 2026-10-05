/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('../avatar/Avatar', () => ({ default: () => <span /> }));
vi.mock('../ui/CalendarIcon', () => ({ default: () => <span /> }));

import InstantNotificationCard from '../InstantNotificationCard';

const touch = (x) => ({ touches: [{ clientX: x }] });
const card = () => screen.getByRole('status');

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('instant notification swipe', () => {
  it('follows the finger at full opacity - it is never faded mid-gesture', () => {
    render(<InstantNotificationCard actorName="Asha" bodyText="hi" onClick={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.touchStart(card(), touch(200));

    for (const x of [190, 150, 100, 40, -40]) {
      fireEvent.touchMove(card(), touch(x));
      expect(card().style.opacity).toBe('');
    }
    expect(card().style.transform).toBe('translateX(-240px)');
  });

  it('snaps back to place at full opacity when released short of the threshold', () => {
    render(<InstantNotificationCard actorName="Asha" bodyText="hi" onClick={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.touchStart(card(), touch(200));
    fireEvent.touchMove(card(), touch(160));
    fireEvent.touchEnd(card());

    expect(card().style.transform).toBe('translateX(0)');
    expect(card().style.opacity).toBe('');
  });

  it('a long swipe slides it clear of the screen, still opaque, and then dismisses it', () => {
    const onDismiss = vi.fn();
    render(<InstantNotificationCard actorName="Asha" bodyText="hi" onClick={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.touchStart(card(), touch(200));
    fireEvent.touchMove(card(), touch(60));
    fireEvent.touchEnd(card());

    expect(card().style.transform).toBe('translateX(-390px)');
    expect(card().style.opacity).toBe('');
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a swipe is not a tap, but a tap still opens the notification', () => {
    const onClick = vi.fn();
    render(<InstantNotificationCard actorName="Asha" bodyText="hi" onClick={onClick} onDismiss={vi.fn()} />);

    fireEvent.touchStart(card(), touch(200));
    fireEvent.touchMove(card(), touch(150));
    fireEvent.click(card());
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.touchEnd(card());
    fireEvent.click(card());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
