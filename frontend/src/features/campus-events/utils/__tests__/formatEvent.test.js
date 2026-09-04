import { describe, it, expect } from 'vitest';
import { formatCardDateBadge, formatDetailDateDisplay, formatDetailTimeDisplay } from '../formatEvent';

describe('formatCardDateBadge', () => {
  it('formats dates in "XX SEP" uppercase format with padded day', () => {
    const d1 = new Date(2026, 8, 10, 10, 0);
    const d2 = new Date(2026, 8, 5, 10, 0);
    const d3 = new Date(2026, 9, 15, 18, 0);
    const d4 = new Date(2026, 0, 1, 0, 0);
    expect(formatCardDateBadge(d1)).toBe('10 SEP');
    expect(formatCardDateBadge(d2)).toBe('05 SEP');
    expect(formatCardDateBadge(d3)).toBe('15 OCT');
    expect(formatCardDateBadge(d4)).toBe('01 JAN');
  });

  it('handles null, undefined, and invalid date inputs gracefully', () => {
    expect(formatCardDateBadge(null)).toBe('');
    expect(formatCardDateBadge(undefined)).toBe('');
    expect(formatCardDateBadge('invalid-date')).toBe('');
  });
});

describe('formatDetailDateDisplay', () => {
  it('formats single-day events with full weekday, month, day, and year', () => {
    const start = new Date(2026, 8, 10, 13, 15); // Thursday, Sept 10, 2026
    const end = new Date(2026, 8, 10, 15, 15);
    expect(formatDetailDateDisplay(start, end)).toBe('Thursday, September 10, 2026');
  });

  it('formats single-day event when end time is missing', () => {
    const start = new Date(2026, 8, 10, 13, 15);
    expect(formatDetailDateDisplay(start, null)).toBe('Thursday, September 10, 2026');
  });

  it('formats multi-day events in the same year', () => {
    const start = new Date(2026, 8, 10, 13, 15);
    const end = new Date(2026, 8, 12, 15, 15);
    expect(formatDetailDateDisplay(start, end)).toBe('September 10 – September 12, 2026');
  });

  it('formats multi-day events spanning different months in the same year', () => {
    const start = new Date(2026, 8, 28, 10, 0);
    const end = new Date(2026, 9, 3, 18, 0);
    expect(formatDetailDateDisplay(start, end)).toBe('September 28 – October 3, 2026');
  });

  it('formats multi-day events across different years', () => {
    const start = new Date(2026, 11, 30, 10, 0);
    const end = new Date(2027, 0, 2, 18, 0);
    expect(formatDetailDateDisplay(start, end)).toBe('December 30, 2026 – January 2, 2027');
  });

  it('handles null and invalid dates gracefully', () => {
    expect(formatDetailDateDisplay(null)).toBe('');
    expect(formatDetailDateDisplay('invalid')).toBe('');
  });
});

describe('formatDetailTimeDisplay', () => {
  it('formats time range with en-dash', () => {
    const start = new Date(2026, 8, 10, 13, 15);
    const end = new Date(2026, 8, 10, 15, 15);
    expect(formatDetailTimeDisplay(start, end)).toBe('1:15 PM – 3:15 PM');
  });

  it('formats single time when end time is identical or omitted', () => {
    const start = new Date(2026, 8, 10, 13, 15);
    expect(formatDetailTimeDisplay(start, null)).toBe('1:15 PM');
    expect(formatDetailTimeDisplay(start, start)).toBe('1:15 PM');
  });

  it('detects all-day events', () => {
    const start = new Date(2026, 8, 10, 0, 0, 0);
    const end = new Date(2026, 8, 10, 23, 59, 0);
    expect(formatDetailTimeDisplay(start, end)).toBe('All day');
  });

  it('handles null and invalid inputs gracefully', () => {
    expect(formatDetailTimeDisplay(null)).toBe('');
    expect(formatDetailTimeDisplay('invalid')).toBe('');
  });
});
