import { describe, it, expect } from 'vitest';
import {
  addDaysISO,
  buildTimeSlots,
  formatDateLabel,
  formatDuration,
  formatTime12,
  minutesToTime,
  monthGrid,
  parseTimeInput,
  timeToMinutes,
} from '../eventDateTime';

describe('parseTimeInput', () => {
  it.each([
    ['9:30pm', '21:30'],
    ['9.30 PM', '21:30'],
    ['930p', '21:30'],
    ['9:30', '09:30'],
    ['930', '09:30'],
    ['0930', '09:30'],
    ['21:15', '21:15'],
    ['2130', '21:30'],
    ['9am', '09:00'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    ['12', '12:00'],
    ['noon', '12:00'],
    ['midnight', '00:00'],
    // An event is scheduled in the afternoon far more often than at 5 AM.
    ['5', '17:00'],
    ['5:30', '17:30'],
    ['05:30', '05:30'],
    ['5am', '05:00'],
  ])('reads %s as %s', (typed, expected) => {
    expect(parseTimeInput(typed)).toBe(expected);
  });

  it.each(['', '  ', 'abc', '25:00', '9:75', '13pm', '0pm', '9:3'])('rejects %j', (typed) => {
    expect(parseTimeInput(typed)).toBeNull();
  });
});

describe('time helpers', () => {
  it('formats 24-hour times as 12-hour labels', () => {
    expect(formatTime12('00:05')).toBe('12:05 AM');
    expect(formatTime12('12:00')).toBe('12:00 PM');
    expect(formatTime12('23:45')).toBe('11:45 PM');
    expect(formatTime12('')).toBe('');
    expect(formatTime12('nope')).toBe('');
  });

  it('converts between minutes and HH:MM', () => {
    expect(timeToMinutes('09:07')).toBe(547);
    expect(timeToMinutes('24:00')).toBeNull();
    expect(minutesToTime(547)).toBe('09:07');
    // Past midnight is not a time of this day.
    expect(minutesToTime(24 * 60)).toBe('');
    expect(minutesToTime(-1)).toBe('');
  });

  it('builds a day of slots', () => {
    const slots = buildTimeSlots(15);
    expect(slots).toHaveLength(96);
    expect(slots[0]).toBe('00:00');
    expect(slots[95]).toBe('23:45');
  });

  it('labels durations', () => {
    expect(formatDuration(15)).toBe('15 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(90)).toBe('1 hr 30 min');
    expect(formatDuration(135)).toBe('2 hr 15 min');
    expect(formatDuration(24 * 60)).toBe('1 day');
    expect(formatDuration(25 * 60)).toBe('1 day 1 hr');
    expect(formatDuration(3 * 24 * 60 + 3 * 60 + 35)).toBe('3 days 3 hr 35 min');
    expect(formatDuration(2 * 24 * 60 + 5)).toBe('2 days 5 min');
    expect(formatDuration(0)).toBe('');
  });
});

describe('date helpers', () => {
  it('moves a date across month and year ends', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysISO('garbage', 1)).toBe('');
  });

  it('omits the year for the current year only', () => {
    const now = new Date(2026, 9, 22);
    expect(formatDateLabel('2026-10-23', now)).toBe('Fri, Oct 23');
    expect(formatDateLabel('2027-01-02', now)).toMatch(/2027/);
  });

  it('lays a month out as whole weeks starting on Sunday', () => {
    const weeks = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0].iso).toBe('2026-09-27');
    expect(weeks[0][4]).toMatchObject({ iso: '2026-10-01', inMonth: true });
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(31);
    // No row that is only the next month.
    expect(weeks.at(-1).some((c) => c.inMonth)).toBe(true);
  });
});
