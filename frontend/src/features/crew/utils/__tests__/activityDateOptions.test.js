import { describe, it, expect } from 'vitest';
import {
  dateWindow, monthOptions, dayOptions, clampDay, timeOptions, daysInMonth, TIME_SLOTS,
} from '../activityDateOptions';

const NOW = new Date(2026, 9, 24, 10, 7); // 24 Oct 2026, 10:07

describe('dateWindow', () => {
  it('start: today through a year ahead', () => {
    const w = dateWindow('start', null, NOW);
    expect(w.min).toEqual(new Date(2026, 9, 24));
    expect(w.max.getFullYear()).toBe(2027);
  });
  it('end with a start: the start day through 30 days after it', () => {
    const start = new Date(2026, 11, 20, 18, 0);
    const w = dateWindow('end', start, NOW);
    expect(w.min).toEqual(new Date(2026, 11, 20));
    expect(w.max.getMonth()).toBe(0);
    expect(w.max.getDate()).toBe(19);
    expect(w.max.getFullYear()).toBe(2027);
  });
  it('end without a start falls back to the start window', () => {
    expect(dateWindow('end', null, NOW)).toEqual(dateWindow('start', null, NOW));
  });
});

describe('monthOptions', () => {
  it('covers the window and shows the year when it crosses one', () => {
    const opts = monthOptions(dateWindow('end', new Date(2026, 11, 20, 18), NOW));
    expect(opts.map((o) => o.label)).toEqual(['Dec 2026', 'Jan 2027']);
    expect(opts[1]).toMatchObject({ year: 2027, month: 1, value: '2027-1' });
  });
  it('uses plain month names inside one year', () => {
    const opts = monthOptions(dateWindow('end', new Date(2026, 9, 25, 9), NOW));
    expect(opts.map((o) => o.label)).toEqual(['October', 'November']);
  });
});

describe('dayOptions', () => {
  it('follows the month length, leap years included', () => {
    const w = { min: new Date(2000, 0, 1), max: new Date(2100, 0, 1) };
    expect(dayOptions(2027, 2, w)).toHaveLength(28);
    expect(dayOptions(2028, 2, w)).toHaveLength(29);
    expect(dayOptions(2026, 10, w)).toHaveLength(31);
    expect(daysInMonth(2026, 11)).toBe(30);
  });
  it('disables days before today', () => {
    const days = dayOptions(2026, 10, dateWindow('start', null, NOW));
    expect(days[22].disabled).toBe(true); // 23rd
    expect(days[23].disabled).toBe(false); // 24th, today
    expect(days[23].label).toBe('Sat 24');
  });
  it('disables end days beyond 30 days after the start', () => {
    const w = dateWindow('end', new Date(2026, 9, 25, 9), NOW);
    const nov = dayOptions(2026, 11, w);
    expect(nov[23].disabled).toBe(false); // 24 Nov
    expect(nov[24].disabled).toBe(true); // 25 Nov
  });
});

describe('clampDay', () => {
  const w = { min: new Date(2026, 9, 24), max: new Date(2027, 9, 24, 23, 59) };
  it('keeps the day when allowed and clamps to the month length', () => {
    expect(clampDay(2026, 12, 15, w)).toBe(15);
    expect(clampDay(2027, 2, 31, w)).toBe(28);
  });
  it('moves to the nearest allowed day', () => {
    expect(clampDay(2026, 10, 3, w)).toBe(24);
    expect(clampDay(2027, 10, 30, w)).toBe(24);
  });
  it('returns null when nothing in the month is allowed', () => {
    expect(clampDay(2026, 9, 3, w)).toBeNull();
  });
});

describe('timeOptions', () => {
  it('offers every 5-minute slot and disables nothing before a day is chosen', () => {
    const opts = timeOptions('start', null, null, NOW);
    expect(opts).toHaveLength(288);
    expect(opts.some((o) => o.disabled)).toBe(false);
    expect(TIME_SLOTS[0].label).toBe('12:00am');
  });
  it('disables past times on today for the start only', () => {
    const today = timeOptions('start', { year: 2026, month: 10, day: 24 }, null, NOW);
    expect(today.find((o) => o.value === '10:5').disabled).toBe(true);
    expect(today.find((o) => o.value === '10:10').disabled).toBe(false);
    const tomorrow = timeOptions('start', { year: 2026, month: 10, day: 25 }, null, NOW);
    expect(tomorrow.some((o) => o.disabled)).toBe(false);
  });
  it('end: at least 5 minutes after the start and within 30 days', () => {
    const start = new Date(2026, 9, 25, 9, 0);
    const same = timeOptions('end', { year: 2026, month: 10, day: 25 }, start, NOW);
    expect(same.find((o) => o.value === '9:0').disabled).toBe(true);
    expect(same.find((o) => o.value === '9:5').disabled).toBe(false);
    const last = timeOptions('end', { year: 2026, month: 11, day: 24 }, start, NOW);
    expect(last.find((o) => o.value === '9:0').disabled).toBe(false);
    expect(last.find((o) => o.value === '9:5').disabled).toBe(true);
  });
});
