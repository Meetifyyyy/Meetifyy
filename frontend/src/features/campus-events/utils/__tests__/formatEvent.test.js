import { describe, it, expect } from 'vitest';
import { formatCardDateBadge } from '../formatEvent';

describe('formatCardDateBadge', () => {
  it('formats dates in "XX SEP" uppercase format with padded day', () => {
    expect(formatCardDateBadge('2026-09-10T10:00:00.000Z')).toBe('10 SEP');
    expect(formatCardDateBadge('2026-09-05T10:00:00.000Z')).toBe('05 SEP');
    expect(formatCardDateBadge('2026-10-15T18:00:00.000Z')).toBe('15 OCT');
    expect(formatCardDateBadge('2026-01-01T00:00:00.000Z')).toBe('01 JAN');
  });

  it('handles null, undefined, and invalid date inputs gracefully', () => {
    expect(formatCardDateBadge(null)).toBe('');
    expect(formatCardDateBadge(undefined)).toBe('');
    expect(formatCardDateBadge('invalid-date')).toBe('');
  });
});
