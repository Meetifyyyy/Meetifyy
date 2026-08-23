import { describe, it, expect } from 'vitest';
import { formatRemaining } from '../useCountdown';

/**
 * The chat header's countdown. It reads a fixed server timestamp — the
 * deadline is never negotiated with the client — so the only thing worth
 * testing here is that the label leads with the unit that is actually moving.
 */
describe('formatRemaining', () => {
  const mins = (n) => n * 60 * 1000;
  const hours = (n) => n * 60 * 60 * 1000;

  it('leads with hours across most of a 24h window', () => {
    expect(formatRemaining(hours(23) + mins(42))).toBe('23h 42m');
    expect(formatRemaining(hours(1) + mins(1))).toBe('1h 1m');
  });

  it('drops to minutes inside the final hour', () => {
    expect(formatRemaining(mins(42))).toBe('42m');
  });

  it('shows seconds only when they are what is changing', () => {
    // Above five minutes the seconds are noise; below it they are the point.
    expect(formatRemaining(mins(6))).toBe('6m');
    expect(formatRemaining(mins(4) + 8000)).toBe('4m 08s');
  });

  it('never renders a negative or absent deadline as time remaining', () => {
    // A suspended tab wakes with a deadline in the past; it must read as
    // spent, not as a wrapped-around number.
    expect(formatRemaining(-5000)).toBe('0m');
    expect(formatRemaining(0)).toBe('0m');
    expect(formatRemaining(null)).toBe('0m');
    expect(formatRemaining(undefined)).toBe('0m');
  });
});
