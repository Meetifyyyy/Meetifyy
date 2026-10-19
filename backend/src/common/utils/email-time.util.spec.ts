import { formatEmailTime, isValidTimeZone } from './email-time.util';

describe('formatEmailTime', () => {
  const at = new Date('2026-10-19T16:00:00Z');

  it("prints the reader's local time with its zone", () => {
    const out = formatEmailTime(at, 'Asia/Kolkata');
    expect(out).toContain('9:30:00 PM');
    expect(out).toContain('GMT+5:30');
  });

  it('falls back to Indian time for a missing or invalid zone', () => {
    expect(formatEmailTime(at)).toContain('9:30:00 PM');
    expect(formatEmailTime(at, 'Not/AZone')).toContain('GMT+5:30');
  });

  it('rejects non-strings and over-long names', () => {
    expect(isValidTimeZone(5)).toBe(false);
    expect(isValidTimeZone('x'.repeat(65))).toBe(false);
    expect(isValidTimeZone('America/New_York')).toBe(true);
  });
});
