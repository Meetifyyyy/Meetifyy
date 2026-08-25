import { describe, it, expect } from 'vitest';
import { deriveActivityPhase, resolveEndTime } from '../useActivityLifecycle';

const T0 = new Date('2026-06-01T12:00:00.000Z').getTime();
const hours = (n) => n * 60 * 60 * 1000;

const activity = (over = {}) => ({
  status: 'OPEN',
  startDate: new Date(T0).toISOString(),
  endDate: new Date(T0 + hours(2)).toISOString(),
  ...over,
});

describe('deriveActivityPhase', () => {
  it('is upcoming a minute before the start time', () => {
    expect(deriveActivityPhase(activity(), T0 - 60_000).phase).toBe('UPCOMING');
  });

  it('flips to started at the exact start instant', () => {
    expect(deriveActivityPhase(activity(), T0).phase).toBe('STARTED');
    expect(deriveActivityPhase(activity(), T0).hasStarted).toBe(true);
  });

  it('flips to ended at the end instant', () => {
    expect(deriveActivityPhase(activity(), T0 + hours(2)).phase).toBe('ENDED');
  });

  it('lets a server-side cancellation win over the clock', () => {
    const p = deriveActivityPhase(activity({ status: 'CANCELLED' }), T0 - hours(5));
    expect(p.phase).toBe('CANCELLED');
    expect(p.hasEnded).toBe(true);
  });

  it('honours a server-side ENDED before the scheduled end', () => {
    expect(deriveActivityPhase(activity({ status: 'ENDED' }), T0 + hours(1)).phase).toBe('ENDED');
  });

  it('treats an activity with no dates as upcoming rather than started', () => {
    const p = deriveActivityPhase({ status: 'OPEN' }, T0);
    expect(p.phase).toBe('UPCOMING');
    expect(p.hasStarted).toBe(false);
  });

  it('ignores an unparseable date instead of throwing', () => {
    expect(deriveActivityPhase({ status: 'OPEN', startDate: 'not-a-date' }, T0).phase).toBe('UPCOMING');
  });
});

describe('resolveEndTime', () => {
  it('uses the explicit end date when present', () => {
    expect(resolveEndTime(activity())).toBe(T0 + hours(2));
  });

  it('falls back to the stated duration', () => {
    expect(resolveEndTime(activity({ endDate: null, duration: '3 hours' }))).toBe(T0 + hours(3));
  });

  it('defaults to one hour when neither is given', () => {
    expect(resolveEndTime(activity({ endDate: null }))).toBe(T0 + hours(1));
  });

  it('has no end time when there is no start time', () => {
    expect(resolveEndTime({ status: 'OPEN' })).toBe(null);
  });
});
